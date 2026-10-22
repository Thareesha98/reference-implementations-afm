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

import { afterEach, describe, it, expect, vi } from "vitest";
import { PRF_EVAL_SALT, PasskeyUnsupportedError, unlockWithPasskey } from "./unlock";

type Asked = CredentialRequestOptions;

function deviceAnswering(answer: unknown): { asked: Asked[] } {
  const asked: Asked[] = [];
  vi.stubGlobal("navigator", {
    credentials: {
      get: async (options: Asked) => {
        asked.push(options);
        return answer;
      },
    },
  });
  return { asked };
}

const withSecret = (first?: BufferSource) => ({
  getClientExtensionResults: () => ({ prf: first === undefined ? undefined : { results: { first } } }),
});

const credentialId = new Uint8Array([1, 2, 3]);

afterEach(() => vi.unstubAllGlobals());

describe("unlockWithPasskey", () => {
  it("asks the device to confirm the person and to evaluate the fixed salt", async () => {
    const { asked } = deviceAnswering(withSecret(new Uint8Array([9])));
    await unlockWithPasskey(credentialId);
    const publicKey = asked[0]?.publicKey;
    expect(publicKey?.userVerification).toBe("required");
    expect(publicKey?.allowCredentials).toEqual([{ type: "public-key", id: credentialId }]);
    expect(publicKey?.extensions).toEqual({ prf: { eval: { first: PRF_EVAL_SALT } } });
    expect((publicKey?.challenge as Uint8Array).length).toBe(32);
  });

  it("gives back the secret the device produced", async () => {
    const secret = new Uint8Array([4, 5, 6]);
    deviceAnswering(withSecret(secret));
    expect(await unlockWithPasskey(credentialId)).toBe(secret);
  });

  it("evaluates another salt when it is given one", async () => {
    const { asked } = deviceAnswering(withSecret(new Uint8Array([1])));
    const salt = new Uint8Array([7, 7]);
    await unlockWithPasskey(credentialId, salt);
    expect(asked[0]?.publicKey?.extensions).toEqual({ prf: { eval: { first: salt } } });
  });

  it("says so when the device does not return a secret", async () => {
    deviceAnswering(withSecret());
    await expect(unlockWithPasskey(credentialId)).rejects.toBeInstanceOf(PasskeyUnsupportedError);
  });

  it("says so when nothing was chosen", async () => {
    deviceAnswering(null);
    await expect(unlockWithPasskey(credentialId)).rejects.toBeInstanceOf(PasskeyUnsupportedError);
  });

  it("lets a refusal from the device through unchanged", async () => {
    const refusal = new Error("The request was cancelled.");
    vi.stubGlobal("navigator", { credentials: { get: async () => Promise.reject(refusal) } });
    await expect(unlockWithPasskey(credentialId)).rejects.toBe(refusal);
  });
});

describe("PRF_EVAL_SALT", () => {
  it("stays the same text, because saved keys can only be opened with the secret it produces", () => {
    expect(new TextDecoder().decode(PRF_EVAL_SALT)).toBe("afm-passkey-prf-v1");
  });
});
