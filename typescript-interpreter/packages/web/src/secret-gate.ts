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
import { secretUseKey } from "@afm/engine";

export interface SecretUse {
  name: string;
  host?: string;
}

export interface SecretGateDeps {
  /** Tool-scoped uses declared by the agent currently loading. */
  toolUses: () => SecretUse[];
  approved: () => Set<string>;
  /** Record an approval for the rest of this load. */
  approve: (uses: SecretUse[]) => void;
  /** Whether the vault holds a value for this name at all. */
  isSaved: (name: string) => Promise<boolean>;
  /** Asks whether the saved value may go to these hosts. Only reached when a value exists to send. */
  askApproval: (name: string, hosts: (string | undefined)[]) => Promise<boolean>;
}

/**
 * A saved secret must not travel to a tool server the user has not approved, or an agent could
 * point a key saved for the model at a server of its own. The consent screen collects approvals up
 * front, but a test chat or a reopened conversation loads an agent without it. Refusing outright
 * there would make a saved secret unusable, so when the vault holds the value the user is asked
 * about the destination directly.
 */
export function destinationGatedVault(inner: SecretPort, deps: SecretGateDeps): SecretPort {
  return {
    async resolve(ref) {
      const uses = deps.toolUses().filter((use) => use.name === ref.name);
      const approved = deps.approved();
      const unapproved = uses.filter((use) => !approved.has(secretUseKey(use.name, use.host)));
      if (unapproved.length === 0) {
        return inner.resolve(ref);
      }

      // Nothing saved means nothing to leak: fall through so the caller asks for a value normally.
      if (!(await deps.isSaved(ref.name))) {
        return {
          status: "unresolved",
          reason: `'${ref.name}' is not in the vault`,
        };
      }

      const hosts = unapproved.map((use) => use.host);
      if (!(await deps.askApproval(ref.name, hosts))) {
        return {
          status: "unresolved",
          reason: `'${ref.name}' is saved on this device but was not approved for ${describeHosts(hosts)}.`,
        };
      }

      deps.approve(unapproved);
      return inner.resolve(ref);
    },
  };
}

export function distinctHosts(hosts: (string | undefined)[]): string[] {
  return [...new Set(hosts.map((host) => host ?? "an undeclared host"))];
}

export function describeHosts(hosts: (string | undefined)[]): string {
  return distinctHosts(hosts).join(", ");
}
