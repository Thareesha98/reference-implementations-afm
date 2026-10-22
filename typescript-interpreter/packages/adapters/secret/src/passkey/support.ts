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

export type PasskeySupport = { usable: true } | { usable: false; reason: string };

export async function passkeySupport(): Promise<PasskeySupport> {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return { usable: false, reason: "Passkeys need a secure connection (https, or localhost)." };
  }
  if (typeof window.PublicKeyCredential !== "function") {
    return { usable: false, reason: "This browser does not support passkeys." };
  }
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available
      ? { usable: true }
      : { usable: false, reason: "This device has no fingerprint, Face or PIN unlock set up." };
  } catch {
    return { usable: false, reason: "This browser could not confirm that passkeys work here." };
  }
}
