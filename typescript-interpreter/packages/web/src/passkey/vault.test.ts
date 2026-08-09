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

const h = vi.hoisted(() => ({
  store: new Map<string, { data: Uint8Array; iv: Uint8Array; credentialId: Uint8Array; salt: Uint8Array }>(),
  known: { current: null as Uint8Array | null },
  ceremonies: [] as Uint8Array[],
}));

vi.mock("./store", () => ({
  listNames: async () => [...h.store.keys()],
  loadBlob: async (name: string) => h.store.get(name) ?? null,
  saveBlob: async (name: string, blob: (typeof h.store) extends Map<string, infer V> ? V : never) => void h.store.set(name, blob),
}));

vi.mock("./unlock", () => ({
  unlockWithPasskey: async (credentialId: Uint8Array) => {
    h.ceremonies.push(credentialId);
    return credentialId;
  },
}));

vi.mock("./enroll", () => ({
  enrollPasskey: async () => ({ credentialId: new Uint8Array([9]), prfOutput: new Uint8Array([9]) }),
}));

vi.mock("./crypto", () => ({
  deriveAesKeyFromPrf: async (prf: unknown, salt: unknown) => ({ prf, salt }),
  randomSalt: () => new Uint8Array([7]),
  encryptString: async () => {
    throw new Error("the main thread must never encrypt a secret");
  },
  decryptString: async () => {
    throw new Error("the main thread must never decrypt a secret");
  },
}));

vi.mock("./credential", () => ({
  knownCredentialId: () => h.known.current,
  rememberCredentialId: (id: Uint8Array) => void (h.known.current = id),
  forgetCredentialId: () => void (h.known.current = null),
}));

const { seal, unlockAll } = await import("./vault");

const A = new Uint8Array([1]) as Uint8Array<ArrayBuffer>;
const B = new Uint8Array([2]) as Uint8Array<ArrayBuffer>;

function put(name: string, credentialId: Uint8Array, value: string): void {
  h.store.set(name, { data: new TextEncoder().encode(value), iv: new Uint8Array([0]), credentialId, salt: new Uint8Array([1]) });
}

beforeEach(() => {
  h.store.clear();
  h.known.current = null;
  h.ceremonies.length = 0;
});

describe("passkey vault", () => {
  it("unlockAll opens every key under one passkey with a single ceremony", async () => {
    put("K1", A, "v1");
    put("K2", A, "v2");
    const posted: { type: string; name?: string }[] = [];
    const opened = await unlockAll((message) => posted.push(message));
    expect(opened).toBe(true);
    expect(h.ceremonies).toHaveLength(1);
    expect(posted.filter((m) => m.type === "unlock-secret").map((m) => m.name)).toEqual(["K1", "K2"]);
  });

  it("has the worker re-seal the stragglers onto one passkey, never touching plaintext itself", async () => {
    h.known.current = A;
    put("K1", A, "v1");
    put("K2", B, "v2");
    const posted: { type: string; name?: string; credentialId?: Uint8Array }[] = [];
    await unlockAll((message) => posted.push(message));
    expect(h.ceremonies).toHaveLength(2);

    const reseals = posted.filter((m) => m.type === "passkey-reseal");
    expect(reseals.map((m) => m.name)).toEqual(["K2"]);
    expect([...reseals[0]!.credentialId!]).toEqual([...A]);
    expect(h.store.get("K2")!.credentialId).toBe(B);
    expect([...h.known.current!]).toEqual([...A]);
  });

  it("answers the worker's pending request instead of a plain unlock", async () => {
    put("K", A, "v");
    const posted: { type: string; id?: string; name?: string }[] = [];
    await unlockAll((message) => posted.push(message), { id: "r1", name: "K", credentialId: A, salt: new Uint8Array([1]) });
    expect(posted.find((m) => m.type === "passkey-unlock-response" && m.id === "r1")).toBeTruthy();
    expect(posted.find((m) => m.type === "unlock-secret" && m.name === "K")).toBeUndefined();
  });

  it("seal reuses the known credential", async () => {
    h.known.current = A;
    const posted: { type: string; name?: string; credentialId?: Uint8Array }[] = [];
    expect(await seal((message) => posted.push(message), "NEW")).toBe(true);
    expect(h.ceremonies).toHaveLength(1);
    const remember = posted.find((m) => m.type === "passkey-remember")!;
    expect(remember.name).toBe("NEW");
    expect([...remember.credentialId!]).toEqual([...A]);
  });

  it("seal enrols a credential the first time", async () => {
    const posted: { type: string; credentialId?: Uint8Array }[] = [];
    await seal((message) => posted.push(message), "FIRST");
    const remember = posted.find((m) => m.type === "passkey-remember")!;
    expect([...remember.credentialId!]).toEqual([9]);
    expect([...h.known.current!]).toEqual([9]);
  });
});
