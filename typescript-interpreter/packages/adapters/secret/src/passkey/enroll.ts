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

import { PRF_EVAL_SALT, PasskeyUnsupportedError, unlockWithPasskey } from "./unlock";

export interface PasskeyEnrollment {
  credentialId: Uint8Array<ArrayBuffer>;
  prfOutput: BufferSource;
}

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export async function enrollPasskey(): Promise<PasskeyEnrollment> {
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "AFM", id: location.hostname },
      user: { id: randomBytes(16), name: "afm-user", displayName: "AFM user" },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: PRF_EVAL_SALT } } },
    },
  })) as PublicKeyCredential | null;

  if (created === null) {
    throw new PasskeyUnsupportedError("Passkey setup did not complete.");
  }
  if (created.getClientExtensionResults().prf?.enabled !== true) {
    throw new PasskeyUnsupportedError("This device's passkey cannot protect a saved key.");
  }

  const credentialId = new Uint8Array(created.rawId);
  const fromCreate = created.getClientExtensionResults().prf?.results?.first;
  return {
    credentialId,
    prfOutput: fromCreate ?? (await unlockWithPasskey(credentialId)),
  };
}
