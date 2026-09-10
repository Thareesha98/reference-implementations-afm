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

import { useEffect, useState } from "react";

type PasskeySupport = { usable: true } | { usable: false; reason: string };

// Remembering a key needs a secure page, the WebAuthn API and a user-verifying platform
// authenticator. The reason is returned so the UI can explain instead of hiding the option.
async function passkeySupport(): Promise<PasskeySupport> {
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
    // Older implementations can reject instead of answering; treat that as not usable.
    return { usable: false, reason: "This browser could not confirm that passkeys work here." };
  }
}

/** null while still being asked. */
export function usePasskeySupport(): PasskeySupport | null {
  const [support, setSupport] = useState<PasskeySupport | null>(null);
  useEffect(() => {
    let live = true;
    void passkeySupport().then((result) => {
      if (live) setSupport(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return support;
}
