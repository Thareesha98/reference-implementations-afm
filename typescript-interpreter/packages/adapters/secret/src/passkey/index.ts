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

export { randomSalt, importPrf, deriveAesKey, encryptString, decryptString } from "./crypto";
export type { SealedValue } from "./crypto";
export { rememberCredentialId, knownCredentialId, forgetCredentialId } from "./credential";
export { saveBlob, loadBlob, listNames, removeBlob } from "./store";
export type { StoredSecret } from "./store";
export { PRF_EVAL_SALT, PasskeyUnsupportedError, unlockWithPasskey } from "./unlock";
export { enrollPasskey } from "./enroll";
export type { PasskeyEnrollment } from "./enroll";
export { passkeySupport } from "./support";
export type { PasskeySupport } from "./support";
export { seal, unlockAll } from "./vault";
export type { Post, VaultMessage } from "./vault";
