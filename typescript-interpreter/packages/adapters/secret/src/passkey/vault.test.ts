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
import type { VaultMessage } from "./vault";

const h = vi.hoisted(() => ({
  store: new Map<string, { data: Uint8Array; iv: Uint8Array; credentialId: Uint8Array; salt: Uint8Array }>(),
  known: { current: null as Uint8Array | null },
  ceremonies: [] as Uint8Array[],
  refuse: { unlock: false, enroll: false },
}));

vi.mock("./store", () => ({
  listNames: async () => [...h.store.keys()],
  loadBlob: async (name: string) => h.store.get(name) ?? null,
  saveBlob: async (name: string, blob: (typeof h.store) extends Map<string, infer V> ? V : never) => void h.store.set(name, blob),
}));

vi.mock("./unlock", () => ({
  unlockWithPasskey: async (credentialId: Uint8Array) => {
    if (h.refuse.unlock) throw new Error("The device did not confirm.");
    h.ceremonies.push(credentialId);
    return credentialId;
  },
}));

vi.mock("./enroll", () => ({
  enrollPasskey: async () => {
    if (h.refuse.enroll) throw new Error("The device did not confirm.");
    h.ceremonies.push(new Uint8Array([9]));
    return { credentialId: new Uint8Array([9]), prfOutput: new Uint8Array([9]) };
  },
}));

vi.mock("./crypto", () => ({
  importPrf: async (prf: unknown) => ({ prf }),
  deriveAesKey: async (prf: unknown, salt: unknown) => ({ prf, salt }),
  randomSalt: () => new Uint8Array([7]),
}));

vi.mock("./credential", () => ({
  knownCredentialId: () => h.known.current,
  rememberCredentialId: (id: Uint8Array) => void (h.known.current = id),
  forgetCredentialId: () => void (h.known.current = null),
}));

type Vault = typeof import("./vault");
let vault: Vault;

const A = new Uint8Array([1]) as Uint8Array<ArrayBuffer>;
const B = new Uint8Array([2]) as Uint8Array<ArrayBuffer>;

const saltOf = (message: VaultMessage) => [...(message as unknown as { key: { salt: Uint8Array } }).key.salt];

function put(name: string, credentialId: Uint8Array, value: string): void {
  h.store.set(name, { data: new TextEncoder().encode(value), iv: new Uint8Array([0]), credentialId, salt: new Uint8Array([1]) });
}

beforeEach(async () => {
  h.store.clear();
  h.known.current = null;
  h.ceremonies.length = 0;
  h.refuse.unlock = false;
  h.refuse.enroll = false;
  vi.resetModules();
  vault = await import("./vault");
});

describe("seal", () => {
  it("reuses the known credential", async () => {
    h.known.current = A;
    const posted: { type: string; name?: string; credentialId?: Uint8Array }[] = [];
    expect(await vault.seal((message) => posted.push(message), "NEW")).toBe(true);
    expect(h.ceremonies).toHaveLength(1);
    const remember = posted.find((m) => m.type === "passkey-remember")!;
    expect(remember.name).toBe("NEW");
    expect([...remember.credentialId!]).toEqual([...A]);
  });

  it("enrols a credential the first time", async () => {
    const posted: { type: string; credentialId?: Uint8Array }[] = [];
    await vault.seal((message) => posted.push(message), "FIRST");
    const remember = posted.find((m) => m.type === "passkey-remember")!;
    expect([...remember.credentialId!]).toEqual([9]);
    expect([...h.known.current!]).toEqual([9]);
  });

  it("derives the key from the same salt it sends along", async () => {
    const posted: VaultMessage[] = [];
    await vault.seal((message) => posted.push(message), "ONE");
    const remember = posted[0] as Extract<VaultMessage, { type: "passkey-remember" }>;
    expect((remember.key as unknown as { salt: Uint8Array }).salt).toBe(remember.salt);
  });

  it("enrols again when the remembered credential is gone from the device and nothing depends on it", async () => {
    h.known.current = A;
    h.refuse.unlock = true;
    const posted: { type: string; credentialId?: Uint8Array }[] = [];
    expect(await vault.seal((message) => posted.push(message), "NEW")).toBe(true);
    expect([...posted[0]!.credentialId!]).toEqual([9]);
    expect([...h.known.current!]).toEqual([9]);
  });

  it("keeps the remembered credential and fails when sealed values still depend on it", async () => {
    h.known.current = A;
    put("OLD", A, "v");
    h.refuse.unlock = true;
    const posted: unknown[] = [];
    expect(await vault.seal((message) => posted.push(message), "NEW")).toBe(false);
    expect(posted).toEqual([]);
    expect([...h.known.current!]).toEqual([...A]);
  });

  it("fails without posting anything when the device will not create a passkey", async () => {
    h.refuse.enroll = true;
    const posted: unknown[] = [];
    expect(await vault.seal((message) => posted.push(message), "NEW")).toBe(false);
    expect(posted).toEqual([]);
  });

  it("asks the device once for a whole tab: a second seal reuses the first answer", async () => {
    h.known.current = A;
    await vault.seal(() => {}, "ONE");
    await vault.seal(() => {}, "TWO");
    expect(h.ceremonies).toHaveLength(1);
  });

  it("asks again after a refresh, because the answer is only kept for the tab", async () => {
    h.known.current = A;
    await vault.seal(() => {}, "ONE");
    vi.resetModules();
    const reloaded = await import("./vault");
    await reloaded.seal(() => {}, "TWO");
    expect(h.ceremonies).toHaveLength(2);
  });
});

describe("unlockAll", () => {
  it("opens every key under one passkey with a single ceremony", async () => {
    put("K1", A, "v1");
    put("K2", A, "v2");
    const posted: VaultMessage[] = [];
    const opened = await vault.unlockAll((message) => posted.push(message));
    expect(opened).toBe(true);
    expect(h.ceremonies).toHaveLength(1);
    expect(posted.filter((m) => m.type === "unlock-secret").map((m) => m.name)).toEqual(["K1", "K2"]);
  });

  it("opens each key with the key derived from its own salt", async () => {
    h.store.set("K1", { data: new Uint8Array([1]), iv: new Uint8Array([0]), credentialId: A, salt: new Uint8Array([41]) });
    h.store.set("K2", { data: new Uint8Array([2]), iv: new Uint8Array([0]), credentialId: A, salt: new Uint8Array([42]) });
    const posted: VaultMessage[] = [];
    await vault.unlockAll((message) => posted.push(message));
    expect(posted.map(saltOf)).toEqual([[41], [42]]);
  });

  it("asks once for each passkey the sealed keys are under", async () => {
    put("K1", A, "v1");
    put("K2", B, "v2");
    const posted: VaultMessage[] = [];
    await vault.unlockAll((message) => posted.push(message));
    expect(h.ceremonies).toHaveLength(2);
    expect(posted.map((m) => m.type)).toEqual(["unlock-secret", "unlock-secret"]);
  });

  it("opens nothing, and asks nothing, when no key is sealed", async () => {
    const posted: VaultMessage[] = [];
    expect(await vault.unlockAll((message) => posted.push(message))).toBe(false);
    expect(h.ceremonies).toHaveLength(0);
    expect(posted).toEqual([]);
  });

  it("opens nothing when the device does not confirm", async () => {
    put("K1", A, "v1");
    h.refuse.unlock = true;
    const posted: VaultMessage[] = [];
    expect(await vault.unlockAll((message) => posted.push(message))).toBe(false);
    expect(posted).toEqual([]);
  });

  it("asks the device once for a whole tab: a seal and an unlock reuse the first answer", async () => {
    h.known.current = A;
    put("OLD", A, "v");
    const post = () => {};
    await vault.seal(post, "ONE");
    await vault.seal(post, "TWO");
    await vault.unlockAll(post);
    expect(h.ceremonies).toHaveLength(1);
  });
});
