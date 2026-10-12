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
import type { StoredSecret } from "./store";

function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const settle = <T,>(result: T) => {
    const request = { result, onsuccess: null as null | (() => void), onerror: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const objectStore = {
    put: (value: unknown, key: string) => settle(void data.set(key, value)),
    get: (key: string) => settle(data.get(key)),
    getAllKeys: () => settle([...data.keys()]),
    delete: (key: string) => settle(void data.delete(key)),
  };
  const db = {
    createObjectStore: () => objectStore,
    transaction: () => ({ objectStore: () => objectStore }),
    addEventListener: () => {},
    close: () => {},
  };
  return {
    data,
    open: () => {
      const request = {
        result: db,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

const bytes = (n: number) => new Uint8Array(new ArrayBuffer(n)).fill(n);
const blob = (): StoredSecret => ({
  data: bytes(8),
  iv: bytes(12),
  credentialId: bytes(16),
  salt: bytes(32),
});

let fake: ReturnType<typeof fakeIndexedDb>;
let saveBlob: typeof import("./store").saveBlob;
let loadBlob: typeof import("./store").loadBlob;
let listNames: typeof import("./store").listNames;
let removeBlob: typeof import("./store").removeBlob;

beforeEach(async () => {
  vi.resetModules();
  fake = fakeIndexedDb();
  vi.stubGlobal("indexedDB", fake);
  ({ saveBlob, loadBlob, listNames, removeBlob } = await import("./store"));
});

describe("the passkey blob store", () => {
  it("round-trips a sealed value under its name", async () => {
    await saveBlob("OPENAI_API_KEY", blob());
    const loaded = await loadBlob("OPENAI_API_KEY");
    expect(loaded).not.toBeNull();
    expect(loaded?.credentialId).toEqual(bytes(16));
    expect(loaded?.salt).toEqual(bytes(32));
  });

  it("returns null rather than undefined for a name that was never saved", async () => {
    expect(await loadBlob("NOPE")).toBeNull();
  });

  it("lists the names it holds, and forgets one on request", async () => {
    await saveBlob("A", blob());
    await saveBlob("B", blob());
    expect((await listNames()).sort()).toEqual(["A", "B"]);

    await removeBlob("A");
    expect(await listNames()).toEqual(["B"]);
    expect(await loadBlob("A")).toBeNull();
  });

  it("writes only ciphertext, iv, credentialId and salt - never a key", async () => {
    await saveBlob("OPENAI_API_KEY", blob());
    const written = fake.data.get("OPENAI_API_KEY") as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["credentialId", "data", "iv", "salt"]);
    expect(JSON.stringify(Object.keys(written))).not.toMatch(/key/i);
  });
});
