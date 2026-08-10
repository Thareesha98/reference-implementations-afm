// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SecretRef } from "@afm/engine";
import type { ServerMessage } from "./protocol";
import { encryptString } from "./passkey/crypto";
import type { StoredSecret } from "./passkey/store";

const disk = new Map<string, StoredSecret>();

vi.mock("./passkey/store", () => ({
  saveBlob: async (name: string, blob: StoredSecret) => void disk.set(name, blob),
  loadBlob: async (name: string) => disk.get(name) ?? null,
  removeBlob: async (name: string) => void disk.delete(name),
  listNames: async () => [...disk.keys()],
}));

const { createWorkerSecretStore } = await import("./worker-secret-store");

const ref = (name: string): SecretRef => ({ prefix: "env", name, raw: `\${env:${name}}` });
const AUTO_LOCK_MS = 5 * 60 * 1000;

const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const credentialId = new Uint8Array([1, 2, 3]);
const salt = new Uint8Array([4, 5, 6]);

async function sealedOnDisk(name: string, value: string, key: CryptoKey): Promise<void> {
  disk.set(name, { ...(await encryptString(key, value)), credentialId, salt });
}

function setup(answerUnlocksWith?: CryptoKey | null) {
  const messages: ServerMessage[] = [];
  const store = createWorkerSecretStore((message) => {
    messages.push(message);
    if (message.type === "passkey-unlock-request" && answerUnlocksWith !== undefined) {
      queueMicrotask(() => store.resolveUnlock(message.id, answerUnlocksWith));
    }
  });
  const lastNames = () => (messages.filter((m) => m.type === "secrets-list").at(-1) as { names: string[] } | undefined)?.names;
  return { store, messages, lastNames };
}

describe("the worker secret store", () => {
  beforeEach(() => disk.clear());
  afterEach(() => vi.useRealTimers());

  describe("values held in memory", () => {
    it("resolves what was set, and only that", async () => {
      const { store } = setup();
      store.set("API_KEY", "sk-1");
      expect(await store.memoryPort.resolve(ref("API_KEY"))).toEqual({ status: "resolved", value: "sk-1" });
      expect((await store.memoryPort.resolve(ref("OTHER"))).status).toBe("unresolved");
    });

    it("ignores an empty value", async () => {
      const { store } = setup();
      store.set("API_KEY", "");
      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
    });

    it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
      "does not mistake the built-in name %s for a saved secret",
      async (name) => {
        const { store } = setup();
        expect((await store.memoryPort.resolve(ref(name))).status).toBe("unresolved");
        expect(store.refreshStore.get(name)).toBeNull();
        expect(await store.isSaved(name)).toBe(false);
      },
    );

    it("tells the main thread which names it holds, never their values", () => {
      const { store, lastNames, messages } = setup();
      store.set("A", "secret-a");
      store.set("B", "secret-b");
      expect(lastNames()).toEqual(["A", "B"]);
      store.remove("A");
      expect(lastNames()).toEqual(["B"]);
      expect(JSON.stringify(messages)).not.toContain("secret-");
    });

    it("backs an OAuth refresh token through the same store", () => {
      const { store, lastNames } = setup();
      store.refreshStore.set("afm.oauth.x.refresh", "rt-1");
      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBe("rt-1");
      expect(lastNames()).toEqual(["afm.oauth.x.refresh"]);
      store.refreshStore.remove("afm.oauth.x.refresh");
      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBeNull();
    });
  });

  describe("sealing a value behind a passkey", () => {
    it("keeps an encrypted copy the derived key can open, and reports the sealed names", async () => {
      const { store, messages } = setup();
      const key = await newKey();
      store.set("API_KEY", "sk-1");
      store.seal("API_KEY", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.has("API_KEY")).toBe(true));

      const blob = disk.get("API_KEY")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("sk-1");
      expect(blob.credentialId).toEqual(credentialId);
      await vi.waitFor(() => expect(messages).toContainEqual({ type: "passkey-list", names: ["API_KEY"] }));
    });

    it("seals nothing for a name that holds no value", async () => {
      const { store } = setup();
      store.seal("MISSING", await newKey(), credentialId, salt);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(disk.size).toBe(0);
    });

    it("knows a secret is saved when only the sealed copy exists", async () => {
      const { store } = setup();
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      expect(await store.isSaved("API_KEY")).toBe(true);
    });

    it("forgets the sealed copy on request", async () => {
      const { store } = setup();
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      store.forgetSealed("API_KEY");
      await vi.waitFor(() => expect(disk.has("API_KEY")).toBe(false));
    });
  });

  describe("re-sealing a value under another passkey", () => {
    const otherCredential = new Uint8Array([7, 8, 9]);
    const otherSalt = new Uint8Array([1, 1, 1]);

    it("moves the sealed copy to the new key without the value reaching memory", async () => {
      const { store } = setup();
      const from = await newKey();
      const to = await newKey();
      await sealedOnDisk("API_KEY", "sk-1", from);

      store.reseal("API_KEY", from, to, otherCredential, otherSalt);
      await vi.waitFor(() => expect(disk.get("API_KEY")?.credentialId).toEqual(otherCredential));

      const blob = disk.get("API_KEY")!;
      expect(blob.salt).toEqual(otherSalt);
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, to, blob.data))).toBe("sk-1");
      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
    });

    it("leaves the sealed copy alone when the old key does not fit", async () => {
      const { store } = setup();
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      const before = disk.get("API_KEY");

      store.reseal("API_KEY", await newKey(), await newKey(), otherCredential, otherSalt);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(disk.get("API_KEY")).toBe(before);
    });

    it("does nothing for a name with no sealed copy", async () => {
      const { store } = setup();
      store.reseal("MISSING", await newKey(), await newKey(), otherCredential, otherSalt);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(disk.size).toBe(0);
    });
  });

  describe("keeping a rotating value sealed", () => {
    it("re-seals a value written through refreshStore after it was already sealed", async () => {
      const { store } = setup();
      const key = await newKey();
      store.refreshStore.set("afm.oauth.x.refresh", "R0");
      store.seal("afm.oauth.x.refresh", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.has("afm.oauth.x.refresh")).toBe(true));

      await store.refreshStore.set("afm.oauth.x.refresh", "R1");

      const blob = disk.get("afm.oauth.x.refresh")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("R1");
    });

    it("skips a save whose value is no longer the current one", async () => {
      const { store } = setup();
      const key = await newKey();
      store.refreshStore.set("afm.oauth.x.refresh", "R0");
      store.seal("afm.oauth.x.refresh", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.has("afm.oauth.x.refresh")).toBe(true));

      const stale = store.refreshStore.set("afm.oauth.x.refresh", "R1");
      const fresh = store.refreshStore.set("afm.oauth.x.refresh", "R2");
      await Promise.all([stale, fresh]);

      const blob = disk.get("afm.oauth.x.refresh")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("R2");
    });

    it("never seals anything for a value that was never remembered", async () => {
      const { store } = setup();
      store.refreshStore.set("afm.oauth.x.refresh", "R0");
      await store.refreshStore.set("afm.oauth.x.refresh", "R1");
      expect(disk.size).toBe(0);
    });

    it("does not recreate the blob once it has been forgotten", async () => {
      const { store } = setup();
      const key = await newKey();
      store.refreshStore.set("afm.oauth.x.refresh", "R0");
      store.seal("afm.oauth.x.refresh", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.has("afm.oauth.x.refresh")).toBe(true));

      store.forgetSealed("afm.oauth.x.refresh");
      await vi.waitFor(() => expect(disk.has("afm.oauth.x.refresh")).toBe(false));
      await store.refreshStore.set("afm.oauth.x.refresh", "R1");

      expect(disk.has("afm.oauth.x.refresh")).toBe(false);
    });

    it("re-seals with the key a value was opened with, however it was unlocked", async () => {
      const key = await newKey();
      const { store } = setup();
      await sealedOnDisk("afm.oauth.x.refresh", "R0", key);
      store.acceptUnlock("afm.oauth.x.refresh", key);
      await vi.waitFor(() => expect(store.refreshStore.get("afm.oauth.x.refresh")).toBe("R0"));

      await store.refreshStore.set("afm.oauth.x.refresh", "R1");

      const blob = disk.get("afm.oauth.x.refresh")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("R1");
    });

    it("re-seals under the new key once a value has moved to another passkey", async () => {
      const oldKey = await newKey();
      const newKeyForBlob = await newKey();
      const { store } = setup();
      await sealedOnDisk("afm.oauth.x.refresh", "R0", oldKey);
      store.acceptUnlock("afm.oauth.x.refresh", oldKey);
      await vi.waitFor(() => expect(store.refreshStore.get("afm.oauth.x.refresh")).toBe("R0"));

      const otherCredential = new Uint8Array([7, 8, 9]);
      const otherSalt = new Uint8Array([1, 1, 1]);
      store.reseal("afm.oauth.x.refresh", oldKey, newKeyForBlob, otherCredential, otherSalt);
      await vi.waitFor(() => expect(disk.get("afm.oauth.x.refresh")?.credentialId).toEqual(otherCredential));

      await store.refreshStore.set("afm.oauth.x.refresh", "R1");

      const blob = disk.get("afm.oauth.x.refresh")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, newKeyForBlob, blob.data))).toBe("R1");
    });

    it("leaves the blob on disk when the value is only removed, the shared 401 path", async () => {
      const { store } = setup();
      const key = await newKey();
      store.refreshStore.set("afm.oauth.x.refresh", "R0");
      store.seal("afm.oauth.x.refresh", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.has("afm.oauth.x.refresh")).toBe(true));

      store.refreshStore.remove("afm.oauth.x.refresh");

      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBeNull();
      expect(disk.has("afm.oauth.x.refresh")).toBe(true);
    });
  });

  describe("opening a sealed value", () => {
    it("asks the main thread to unlock, then decrypts with the key it sends back", async () => {
      const key = await newKey();
      const { store, messages } = setup(key);
      await sealedOnDisk("API_KEY", "sk-1", key);

      expect(await store.passkeyPort.resolve(ref("API_KEY"))).toEqual({ status: "resolved", value: "sk-1" });
      expect(messages.some((m) => m.type === "passkey-unlock-request" && m.name === "API_KEY")).toBe(true);
    });

    it("is unresolved when nothing was sealed", async () => {
      const { store } = setup(await newKey());
      expect((await store.passkeyPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
    });

    it("is unresolved when the user declines the unlock", async () => {
      const { store } = setup(null);
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      expect(await store.passkeyPort.resolve(ref("API_KEY"))).toMatchObject({ status: "unresolved", reason: expect.stringContaining("not unlocked") });
    });

    it("is unresolved when the key does not fit the sealed copy", async () => {
      const { store } = setup(await newKey());
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      expect(await store.passkeyPort.resolve(ref("API_KEY"))).toMatchObject({ status: "unresolved", reason: expect.stringContaining("could not be unlocked") });
    });

    it("accepts a key the main thread sends unasked, for a panel that opened one on purpose", async () => {
      const key = await newKey();
      const { store, lastNames } = setup();
      await sealedOnDisk("API_KEY", "sk-1", key);
      store.acceptUnlock("API_KEY", key);
      await vi.waitFor(() => expect(lastNames()).toEqual(["API_KEY"]));
      expect(await store.memoryPort.resolve(ref("API_KEY"))).toEqual({ status: "resolved", value: "sk-1" });
    });
  });

  describe("auto-lock", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));

    async function unlocked(name = "API_KEY") {
      const key = await newKey();
      const setupResult = setup(key);
      await sealedOnDisk(name, "sk-1", key);
      await setupResult.store.passkeyPort.resolve(ref(name));
      return setupResult;
    }

    it("drops an unlocked value after five idle minutes, and says so", async () => {
      const { store, lastNames } = await unlocked();
      expect(lastNames()).toEqual(["API_KEY"]);

      vi.advanceTimersByTime(AUTO_LOCK_MS);

      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
      expect(lastNames()).toEqual([]);
    });

    it("stays unlocked while there is activity", async () => {
      const { store } = await unlocked();
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1000);
      store.touch();
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1000);
      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("resolved");
    });

    it("never locks a value that was only typed, since there is nothing to unlock it from", async () => {
      const { store } = await unlocked();
      store.set("TYPED", "typed-value");
      vi.advanceTimersByTime(AUTO_LOCK_MS);
      expect((await store.memoryPort.resolve(ref("TYPED"))).status).toBe("resolved");
      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
    });

    it("locks a remembered sign-in that was unlocked for a run, like any other unlocked secret", async () => {
      const key = await newKey();
      const { store, lastNames } = setup(key);
      await sealedOnDisk("afm.oauth.x.refresh", "rt-1", key);

      await store.loadSealedRefresh("afm.oauth.x.refresh");
      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBe("rt-1");
      expect(lastNames()).toEqual(["afm.oauth.x.refresh"]);

      vi.advanceTimersByTime(AUTO_LOCK_MS);

      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBeNull();
    });

    it("keeps re-sealing a rotating sign-in after auto-lock", async () => {
      const key = await newKey();
      const { store } = setup(key);
      await sealedOnDisk("afm.oauth.x.refresh", "R0", key);
      await store.loadSealedRefresh("afm.oauth.x.refresh");
      store.refreshStore.set("afm.oauth.x.refresh", "R0");

      vi.advanceTimersByTime(AUTO_LOCK_MS);
      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBeNull();

      vi.useRealTimers();
      await store.refreshStore.set("afm.oauth.x.refresh", "R1");

      const blob = disk.get("afm.oauth.x.refresh")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("R1");
    });

    it("drops a typed secret's key on auto-lock, so it cannot be silently re-sealed afterwards", async () => {
      const key = await newKey();
      const { store } = setup(key);
      await sealedOnDisk("API_KEY", "sk-1", key);
      await store.passkeyPort.resolve(ref("API_KEY"));

      vi.advanceTimersByTime(AUTO_LOCK_MS);
      vi.useRealTimers();
      await store.refreshStore.set("API_KEY", "sk-2");

      const blob = disk.get("API_KEY")!;
      expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.data))).toBe("sk-1");
    });
  });
});
