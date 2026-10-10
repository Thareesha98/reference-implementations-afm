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

import type { AgentMetadata, SecretPort } from "@afm/engine";
import { MissingCredentialError } from "./failure";

const ENV_REFERENCE = /^\$\{env:([^}]+)\}$/;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The secret uses a probed server declares, scoped to that server alone - never the uses of
 * whichever agent last loaded, or an edit to one server's address could silently reuse an
 * approval the user gave a different server.
 */
export function probeToolUses(tools: AgentMetadata["tools"]): { name: string; host?: string }[] {
  const uses: { name: string; host?: string }[] = [];
  for (const server of tools?.mcp ?? []) {
    if (server.transport.type !== "http" || server.transport.authentication === undefined) continue;
    const host = hostOf(server.transport.url);
    for (const value of Object.values(server.transport.authentication)) {
      if (typeof value !== "string") continue;
      const name = ENV_REFERENCE.exec(value.trim())?.[1]?.trim();
      if (name !== undefined && name !== "") uses.push({ name, host });
    }
  }
  return uses;
}

async function resolveValues<T extends Record<string, unknown>>(
  auth: T,
  secrets: SecretPort,
): Promise<T> {
  const resolved: Record<string, unknown> = { ...auth };
  for (const [key, value] of Object.entries(auth)) {
    if (typeof value !== "string") continue;
    const name = ENV_REFERENCE.exec(value.trim())?.[1]?.trim();
    if (name === undefined || name === "") continue;
    const resolution = await secrets.resolve({ prefix: "env", name, raw: value });
    if (resolution.status !== "resolved") throw new MissingCredentialError(name);
    resolved[key] = resolution.value;
  }
  return resolved as T;
}

/**
 * Turns the `${env:NAME}` references in a server's auth block into their values. A run never needs
 * this (variables resolve before the metadata exists), but a probe receives the panel's own text,
 * and a reference sent as a credential is just a wrong password.
 */
export async function resolveProbeAuth(
  tools: AgentMetadata["tools"],
  secrets: SecretPort,
): Promise<AgentMetadata["tools"]> {
  const servers = tools?.mcp;
  if (servers === undefined) return tools;
  return {
    ...tools,
    mcp: await Promise.all(
      servers.map(async (server) =>
        server.transport.type === "http" && server.transport.authentication !== undefined
          ? {
              ...server,
              transport: {
                ...server.transport,
                authentication: await resolveValues(server.transport.authentication, secrets),
              },
            }
          : server,
      ),
    ),
  };
}
