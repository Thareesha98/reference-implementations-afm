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

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SecretRef } from "@afm/engine";
import type { ServerMessage } from "./protocol";
import { encryptString } from "./passkey/crypto";
import type { StoredSecret } from "./passkey/store";

const disk = new Map<string, StoredSecret>();
const slowReads = new Map<string, Promise<void>>();

vi.mock("./passkey/store", () => ({
  saveBlob: async (name: string, blob: StoredSecret) => void disk.set(name, blob),
  loadBlob: async (name: string) => {
    await slowReads.get(name);
    return disk.get(name) ?? null;
  },
  removeBlob: async (name: string) => void disk.delete(name),
  listNames: async () => [...disk.keys()],
}));

const { createWorkerSecretStore } = await import("./worker-secret-store");

const ref = (name: string): SecretRef => ({ prefix: "env", name, raw: `\${env:${name}}` });

const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const credentialId = new Uint8Array([1, 2, 3]);
const salt = new Uint8Array([4, 5, 6]);

async function sealedOnDisk(name: string, value: string, key: CryptoKey): Promise<void> {
  disk.set(name, { ...(await encryptString(key, value)), credentialId, salt });
}

function setup() {
  const messages: ServerMessage[] = [];
  const store = createWorkerSecretStore((message) => void messages.push(message));
  const lastNames = () => (messages.filter((m) => m.type === "secrets-list").at(-1) as { names: string[] } | undefined)?.names;
  return { store, messages, lastNames };
}

describe("the worker secret store", () => {
  beforeEach(() => {
    disk.clear();
    slowReads.clear();
  });

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
        expect(store.approvedFor(name, "x.example")).toBe(false);
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

    it("reports the names sealed on disk", async () => {
      const { store, messages } = setup();
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      store.postSealedNames();
      await vi.waitFor(() => expect(messages).toContainEqual({ type: "passkey-list", names: ["API_KEY"] }));
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
    it("decrypts with the key the main thread sends, and tells it which names it now holds", async () => {
      const key = await newKey();
      const { store, lastNames } = setup();
      await sealedOnDisk("API_KEY", "sk-1", key);
      store.acceptUnlock("API_KEY", key);
      await store.opened();
      expect(lastNames()).toEqual(["API_KEY"]);
      expect(await store.memoryPort.resolve(ref("API_KEY"))).toEqual({ status: "resolved", value: "sk-1" });
    });

    it("holds nothing for a key that does not fit the sealed copy", async () => {
      const { store } = setup();
      await sealedOnDisk("API_KEY", "sk-1", await newKey());
      store.acceptUnlock("API_KEY", await newKey());
      await store.opened();
      expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("unresolved");
    });

    it("holds nothing for a name with no sealed copy", async () => {
      const { store } = setup();
      store.acceptUnlock("MISSING", await newKey());
      await store.opened();
      expect((await store.memoryPort.resolve(ref("MISSING"))).status).toBe("unresolved");
    });

    it("lets every key sent before it finish opening, however slowly the disk answers", async () => {
      const modelKey = await newKey();
      const refreshKey = await newKey();
      const { store } = setup();
      await sealedOnDisk("API_KEY", "sk-1", modelKey);
      await sealedOnDisk("afm.oauth.x.refresh", "R0", refreshKey);
      let release!: () => void;
      slowReads.set("afm.oauth.x.refresh", new Promise<void>((resolve) => (release = resolve)));

      store.acceptUnlock("afm.oauth.x.refresh", refreshKey);
      store.acceptUnlock("API_KEY", modelKey);
      const done = store.opened();
      setTimeout(release);
      await done;

      expect(store.refreshStore.get("afm.oauth.x.refresh")).toBe("R0");
      expect(await store.memoryPort.resolve(ref("API_KEY"))).toEqual({ status: "resolved", value: "sk-1" });
    });

    it("keeps a value for the whole tab: nothing locks it after a while", async () => {
      vi.useFakeTimers();
      try {
        const key = await newKey();
        const { store } = setup();
        await sealedOnDisk("API_KEY", "sk-1", key);
        store.acceptUnlock("API_KEY", key);
        await store.opened();
        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
        expect((await store.memoryPort.resolve(ref("API_KEY"))).status).toBe("resolved");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("the hosts a value was entered for", () => {
    it("approves a value only for the host it was entered for", () => {
      const { store } = setup();
      store.set("HF_TOKEN", "hf_1", "huggingface.co");
      expect(store.approvedFor("HF_TOKEN", "huggingface.co")).toBe(true);
      expect(store.approvedFor("HF_TOKEN", "attacker.example")).toBe(false);
      expect(store.approvedFor("HF_TOKEN", undefined)).toBe(false);
    });

    it("approves no host for a value entered without one, such as the model key", () => {
      const { store } = setup();
      store.set("OPENAI_API_KEY", "sk-1");
      expect(store.approvedFor("OPENAI_API_KEY", "huggingface.co")).toBe(false);
    });

    it("forgets the old hosts when the value is entered again for another", () => {
      const { store } = setup();
      store.set("TOKEN", "one", "a.example");
      store.set("TOKEN", "two", "b.example");
      expect(store.approvedFor("TOKEN", "a.example")).toBe(false);
      expect(store.approvedFor("TOKEN", "b.example")).toBe(true);
    });

    it("forgets them when the value is removed", () => {
      const { store } = setup();
      store.set("TOKEN", "one", "a.example");
      store.remove("TOKEN");
      expect(store.approvedFor("TOKEN", "a.example")).toBe(false);
    });

    it("saves them with the sealed copy and brings them back when it is opened", async () => {
      const key = await newKey();
      const first = setup();
      first.store.set("HF_TOKEN", "hf_1", "huggingface.co");
      first.store.seal("HF_TOKEN", key, credentialId, salt);
      await vi.waitFor(() => expect(disk.get("HF_TOKEN")?.hosts).toEqual(["huggingface.co"]));

      const reloaded = setup();
      reloaded.store.acceptUnlock("HF_TOKEN", key);
      await reloaded.store.opened();
      expect(reloaded.store.approvedFor("HF_TOKEN", "huggingface.co")).toBe(true);
      expect(reloaded.store.approvedFor("HF_TOKEN", "attacker.example")).toBe(false);
    });

    it("keeps them when the sealed copy moves to another passkey", async () => {
      const { store } = setup();
      const from = await newKey();
      await sealedOnDisk("HF_TOKEN", "hf_1", from);
      disk.get("HF_TOKEN")!.hosts = ["huggingface.co"];

      store.reseal("HF_TOKEN", from, await newKey(), new Uint8Array([7]), new Uint8Array([8]));
      await vi.waitFor(() => expect(disk.get("HF_TOKEN")?.credentialId).toEqual(new Uint8Array([7])));
      expect(disk.get("HF_TOKEN")?.hosts).toEqual(["huggingface.co"]);
    });
  });
});
