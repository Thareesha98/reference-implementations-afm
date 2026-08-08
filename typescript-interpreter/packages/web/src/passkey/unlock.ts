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

/** Thrown when the device cannot do PRF; the caller falls back to memory only. */
export class PasskeyUnsupportedError extends Error {}

// What the authenticator evaluates its PRF over. It must never change, or stored ciphertext can no
// longer be opened. Not a secret.
export const PRF_EVAL_SALT = new TextEncoder().encode("afm-passkey-prf-v1");

/**
 * One passkey ceremony, returning the PRF output. Must run on the main thread inside a user
 * gesture.
 */
export async function unlockWithPasskey(
  credentialId: BufferSource,
  salt: BufferSource = PRF_EVAL_SALT,
): Promise<BufferSource> {
  const asserted = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  })) as PublicKeyCredential | null;

  const prfOutput = asserted?.getClientExtensionResults().prf?.results?.first;
  if (prfOutput === undefined) {
    throw new PasskeyUnsupportedError("This device did not return a passkey secret.");
  }
  return prfOutput;
}
