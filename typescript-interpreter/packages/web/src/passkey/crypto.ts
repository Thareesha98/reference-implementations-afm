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

// One encryption key per stored value. The PRF output is constant for a passkey, so a random
// per-value salt goes into HKDF.
const HKDF_INFO = new TextEncoder().encode("afm-secret-v1");

// Uint8Array is generic over its buffer since TS 5.7, and WebCrypto rejects
// SharedArrayBuffer-backed views, so ArrayBuffer is explicit.
export interface SealedValue {
  iv: Uint8Array<ArrayBuffer>;
  data: Uint8Array<ArrayBuffer>;
}

/** Fresh HKDF salt, stored beside the ciphertext. */
export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function deriveAesKeyFromPrf(prfOutput: BufferSource, salt: BufferSource): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    // Non-extractable: the key bytes cannot be read back out.
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(key: CryptoKey, text: string): Promise<SealedValue> {
  // AES-GCM needs a unique IV per key, so each value gets a random one.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { iv, data: new Uint8Array(data) };
}

export async function decryptString(key: CryptoKey, sealed: SealedValue): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.data);
  return new TextDecoder().decode(plain);
}
