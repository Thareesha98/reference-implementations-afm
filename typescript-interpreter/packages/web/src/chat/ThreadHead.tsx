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

import { agentInitial } from "./starters";

/** The agent, once, at the top of the thread; alignment already says who is speaking. */
export function ThreadHead({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <div className="xc-hero">
      <div className="xc-glow" aria-hidden="true" />
      <div className="xc-row">
        <span className={`xc-av ${small ? "sm" : ""}`} aria-hidden="true">
          {agentInitial(name)}
        </span>
        <span className={small ? "xc-name-sm" : "xc-name"}>{name}</span>
      </div>
    </div>
  );
}
