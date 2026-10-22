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
import { knownCredentialId, rememberCredentialId, forgetCredentialId } from "./credential";

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage;
}

describe("the remembered passkey credential", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
  });

  it("knows about nothing until a passkey has been enrolled", () => {
    expect(knownCredentialId()).toBeNull();
  });

  it("gives back exactly the bytes it was handed", () => {
    const id = new Uint8Array([0, 1, 2, 250, 255]) as Uint8Array<ArrayBuffer>;
    rememberCredentialId(id);
    expect(Array.from(knownCredentialId() ?? [])).toEqual([0, 1, 2, 250, 255]);
  });

  it("forgets one that is gone from the device, so the next save can enrol again", () => {
    rememberCredentialId(new Uint8Array([7]) as Uint8Array<ArrayBuffer>);
    forgetCredentialId();
    expect(knownCredentialId()).toBeNull();
  });

  it("stays quiet when storage is unavailable rather than failing the save", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => rememberCredentialId(new Uint8Array([1]) as Uint8Array<ArrayBuffer>)).not.toThrow();
    expect(knownCredentialId()).toBeNull();
  });
});
