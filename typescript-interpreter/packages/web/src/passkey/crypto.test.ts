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
import { importPrf, deriveAesKey, encryptString, decryptString, randomSalt } from "./crypto";

const derive = async (prf: BufferSource, salt: BufferSource) => deriveAesKey(await importPrf(prf), salt);

const prfOutput = () => crypto.getRandomValues(new Uint8Array(32));
const SECRET = "sk-proj-abc123-not-a-real-key";

describe("deriveAesKey", () => {
  it("produces a key that cannot be exported", async () => {
    const key = await derive(prfOutput(), randomSalt());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("rebuilds the identical key from the same passkey and salt", async () => {
    const prf = prfOutput();
    const salt = randomSalt();
    const sealed = await encryptString(await derive(prf, salt), SECRET);
    const reopened = await derive(prf, salt);
    expect(await decryptString(reopened, sealed)).toBe(SECRET);
  });

  it("gives a different key for a different passkey", async () => {
    const salt = randomSalt();
    const sealed = await encryptString(await derive(prfOutput(), salt), SECRET);
    const otherDevice = await derive(prfOutput(), salt);
    await expect(decryptString(otherDevice, sealed)).rejects.toThrow();
  });

  it("gives a different key for a different salt, so two stored values never share one", async () => {
    const prf = prfOutput();
    const sealed = await encryptString(await derive(prf, randomSalt()), SECRET);
    const wrongSalt = await derive(prf, randomSalt());
    await expect(decryptString(wrongSalt, sealed)).rejects.toThrow();
  });
});

describe("encryptString / decryptString", () => {
  it("round-trips a value", async () => {
    const key = await derive(prfOutput(), randomSalt());
    expect(await decryptString(key, await encryptString(key, SECRET))).toBe(SECRET);
  });

  it("uses a fresh 12-byte iv every time, so one key can seal many values", async () => {
    const key = await derive(prfOutput(), randomSalt());
    const first = await encryptString(key, SECRET);
    const second = await encryptString(key, SECRET);
    expect(first.iv).toHaveLength(12);
    expect(first.iv.join()).not.toBe(second.iv.join());
    expect(first.data.join()).not.toBe(second.data.join());
  });

  it("does not leave the value readable in the ciphertext", async () => {
    const key = await derive(prfOutput(), randomSalt());
    const sealed = await encryptString(key, SECRET);
    expect(new TextDecoder().decode(sealed.data)).not.toContain("sk-proj");
  });

  it("refuses a blob whose ciphertext was altered", async () => {
    const key = await derive(prfOutput(), randomSalt());
    const sealed = await encryptString(key, SECRET);
    const tampered = { iv: sealed.iv, data: new Uint8Array(sealed.data) };
    tampered.data[0] = (tampered.data[0] ?? 0) ^ 1;
    await expect(decryptString(key, tampered)).rejects.toThrow();
  });

  it("refuses a blob whose iv was altered", async () => {
    const key = await derive(prfOutput(), randomSalt());
    const sealed = await encryptString(key, SECRET);
    const tampered = { iv: new Uint8Array(sealed.iv), data: sealed.data };
    tampered.iv[0] = (tampered.iv[0] ?? 0) ^ 1;
    await expect(decryptString(key, tampered)).rejects.toThrow();
  });
});

describe("randomSalt", () => {
  it("is 32 bytes and different each call", () => {
    expect(randomSalt()).toHaveLength(32);
    expect(randomSalt().join()).not.toBe(randomSalt().join());
  });
});
