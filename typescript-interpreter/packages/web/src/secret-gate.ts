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

import type { SecretPort } from "@afm/engine";

export interface SecretUse {
  name: string;
  host?: string;
}

export interface SecretGateDeps {
  /** Tool-scoped uses declared by the agent currently loading. */
  toolUses: () => SecretUse[];
  /** Whether the value was entered for this destination. */
  approvedFor: (name: string, host: string | undefined) => boolean;
}

/**
 * A saved secret must not travel to a tool server it was not entered for, or an agent could point a
 * key saved for the model at a server of its own. Entering a value in a server's own window is the
 * approval, so nothing is ever asked: a use the value was not entered for simply does not resolve.
 */
export function destinationGatedVault(inner: SecretPort, deps: SecretGateDeps): SecretPort {
  return {
    async resolve(ref) {
      const unapproved = deps.toolUses().filter((use) => use.name === ref.name && !deps.approvedFor(use.name, use.host));
      if (unapproved.length === 0) return inner.resolve(ref);
      return {
        status: "unresolved",
        reason: `'${ref.name}' was not entered for ${describeHosts(unapproved.map((use) => use.host))}.`,
      };
    },
  };
}

export function describeHosts(hosts: (string | undefined)[]): string {
  return [...new Set(hosts.map((host) => host ?? "an undeclared host"))].join(", ");
}
