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

import { usePasskeySupport } from "../../passkey/usePasskeySupport";

const TAB_ONLY = "Kept only for this tab. Gone when you close or refresh it.";
const ON_DEVICE = "Saved on this device. Your device asks for a fingerprint, Face or PIN when you save.";

export function KeepOnDevice({ keep, onChange }: { keep: boolean; onChange: (keep: boolean) => void }) {
  const support = usePasskeySupport();
  const usable = support?.usable === true;
  return (
    <>
      <label className="u-checkline">
        <input type="checkbox" checked={keep && usable} disabled={!usable} onChange={(event) => onChange(event.target.checked)} />
        Keep on this device
      </label>
      <p className="u-hint">{usable ? (keep ? ON_DEVICE : TAB_ONLY) : `${TAB_ONLY} ${support?.usable === false ? support.reason : ""}`.trim()}</p>
    </>
  );
}
