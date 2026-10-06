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

import { useState } from "react";
import { agentInitial } from "./starters";

export function iconUrlError(value: string): string | null {
  let protocol = "";
  try {
    protocol = new URL(value.trim()).protocol;
  } catch {
    return "Paste a full link that starts with https://";
  }
  return protocol === "https:" ? null : "Use a link that starts with https://";
}

export function AgentAvatar({ name, iconUrl = "", className }: { name: string; iconUrl?: string; className: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  const show = iconUrl !== "" && iconUrl !== failedUrl && iconUrlError(iconUrl) === null;
  return (
    <span className={show ? `${className} has-img` : className} aria-hidden="true">
      {show ? (
        <img src={iconUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(iconUrl)} />
      ) : (
        agentInitial(name)
      )}
    </span>
  );
}
