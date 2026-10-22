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

import { describe, it, expect } from "vitest";
import { importPrf, deriveAesKey, randomSalt } from "./crypto";

const derive = async (prf: BufferSource, salt: BufferSource) => deriveAesKey(await importPrf(prf), salt);

const prfOutput = () => crypto.getRandomValues(new Uint8Array(32));

describe("deriveAesKey", () => {
  it("produces a key that cannot be exported", async () => {
    const key = await derive(prfOutput(), randomSalt());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("produces a 256-bit AES-GCM key that can only encrypt and decrypt", async () => {
    const key = await derive(prfOutput(), randomSalt());
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(key.usages.sort()).toEqual(["decrypt", "encrypt"]);
  });
});

describe("importPrf", () => {
  it("keeps the passkey secret as a key that cannot be exported", async () => {
    const prf = await importPrf(prfOutput());
    expect(prf.extractable).toBe(false);
    expect(prf.usages).toEqual(["deriveKey"]);
  });
});

describe("randomSalt", () => {
  it("is 32 bytes and different each call", () => {
    expect(randomSalt()).toHaveLength(32);
    expect(randomSalt().join()).not.toBe(randomSalt().join());
  });
});
