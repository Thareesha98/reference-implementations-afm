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
import { enrollPasskey } from "./enroll";
import { PRF_EVAL_SALT, PasskeyUnsupportedError } from "./unlock";

type Asked = CredentialCreationOptions;

const created = (prf: { enabled?: boolean; first?: BufferSource } | undefined) => ({
  rawId: new Uint8Array([5, 6]).buffer,
  getClientExtensionResults: () => ({
    prf: prf === undefined ? undefined : { enabled: prf.enabled, results: prf.first === undefined ? undefined : { first: prf.first } },
  }),
});

function device(options: { create: unknown; get?: unknown }): { asked: Asked[]; unlocked: number } {
  const record = { asked: [] as Asked[], unlocked: 0 };
  vi.stubGlobal("location", { hostname: "app.example.test" });
  vi.stubGlobal("navigator", {
    credentials: {
      create: async (asked: Asked) => {
        record.asked.push(asked);
        return options.create;
      },
      get: async () => {
        record.unlocked += 1;
        return options.get ?? null;
      },
    },
  });
  return record;
}

afterEach(() => vi.unstubAllGlobals());

describe("enrollPasskey", () => {
  it("asks for a passkey for this site that needs the person's fingerprint, Face or PIN", async () => {
    const record = device({ create: created({ enabled: true, first: new Uint8Array([1]) }) });
    await enrollPasskey();
    const publicKey = record.asked[0]?.publicKey;
    expect(publicKey?.rp).toEqual({ name: "AFM", id: "app.example.test" });
    expect(publicKey?.authenticatorSelection).toEqual({ residentKey: "required", userVerification: "required" });
    expect(publicKey?.pubKeyCredParams?.map((param) => param.alg)).toEqual([-7, -257]);
    expect(publicKey?.extensions).toEqual({ prf: { eval: { first: PRF_EVAL_SALT } } });
    expect((publicKey?.challenge as Uint8Array).length).toBe(32);
    expect((publicKey?.user.id as Uint8Array).length).toBe(16);
  });

  it("uses a different user id for every passkey", async () => {
    const record = device({ create: created({ enabled: true, first: new Uint8Array([1]) }) });
    await enrollPasskey();
    await enrollPasskey();
    const [first, second] = record.asked.map((asked) => Array.from(asked.publicKey?.user.id as Uint8Array).join());
    expect(first).not.toBe(second);
  });

  it("returns the credential id and the secret the device produced", async () => {
    const secret = new Uint8Array([8, 9]);
    device({ create: created({ enabled: true, first: secret }) });
    const enrollment = await enrollPasskey();
    expect(Array.from(enrollment.credentialId)).toEqual([5, 6]);
    expect(enrollment.prfOutput).toBe(secret);
  });

  it("asks the device once more when creating the passkey did not return a secret", async () => {
    const secret = new Uint8Array([3]);
    const record = device({
      create: created({ enabled: true }),
      get: { getClientExtensionResults: () => ({ prf: { results: { first: secret } } }) },
    });
    const enrollment = await enrollPasskey();
    expect(record.unlocked).toBe(1);
    expect(enrollment.prfOutput).toBe(secret);
  });

  it("does not ask again when creating the passkey already returned a secret", async () => {
    const record = device({ create: created({ enabled: true, first: new Uint8Array([1]) }) });
    await enrollPasskey();
    expect(record.unlocked).toBe(0);
  });

  it("refuses a passkey that cannot protect a saved key", async () => {
    device({ create: created({ enabled: false }) });
    await expect(enrollPasskey()).rejects.toThrow("This device's passkey cannot protect a saved key.");
    device({ create: created(undefined) });
    await expect(enrollPasskey()).rejects.toBeInstanceOf(PasskeyUnsupportedError);
  });

  it("says so when nothing was created", async () => {
    device({ create: null });
    await expect(enrollPasskey()).rejects.toThrow("Passkey setup did not complete.");
  });

  it("lets a refusal from the device through unchanged", async () => {
    const refusal = new Error("The request was cancelled.");
    vi.stubGlobal("location", { hostname: "app.example.test" });
    vi.stubGlobal("navigator", { credentials: { create: async () => Promise.reject(refusal) } });
    await expect(enrollPasskey()).rejects.toBe(refusal);
  });
});
