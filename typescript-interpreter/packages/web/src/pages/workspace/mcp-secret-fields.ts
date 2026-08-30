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

import { envSecretName } from "./agent-source-edit";

// The auth fields that hold a credential, and what each is called once captured. Other fields, such
// as a username or header name, are configuration and stay in the file.
const SECRET_SUFFIX: Record<string, string> = {
  token: "_TOKEN",
  password: "_PASSWORD",
  api_key: "_API_KEY",
};

export function isSecretAuthField(fieldKey: string): boolean {
  return SECRET_SUFFIX[fieldKey] !== undefined;
}

/**
 * The env name a captured secret is filed under: the server's name, then the field. `taken` is
 * every name already used, in the file or earlier in the same save, so two servers named alike
 * never share a value.
 */
export function mcpSecretEnvName(serverName: string, fieldKey: string, taken: string[]): string {
  const base =
    serverName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "MCP";
  const name = `${base}${SECRET_SUFFIX[fieldKey] ?? ""}`;
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export interface AuthCapture {
  /** What to write into the file: a reference wherever a credential was given. */
  fields: Record<string, string>;
  /** What to hand the worker, so the value lives there and not in the file. */
  secrets: { name: string; value: string }[];
}

/**
 * Splits an auth block into what the file may hold and what it may not. A credential typed in full
 * becomes a `${env:NAME}` reference and is handed back separately; a field that already references
 * a name keeps it, so re-saving does not rename its secret.
 */
export function captureAuthSecrets(
  serverName: string,
  fields: Record<string, string>,
  taken: string[],
): AuthCapture {
  const out: Record<string, string> = {};
  const secrets: { name: string; value: string }[] = [];
  const spokenFor = [...taken];

  for (const [key, value] of Object.entries(fields)) {
    if (!isSecretAuthField(key) || envSecretName(value) !== "") {
      out[key] = value;
      continue;
    }
    const name = mcpSecretEnvName(serverName, key, spokenFor);
    spokenFor.push(name);
    secrets.push({ name, value });
    out[key] = `\${env:${name}}`;
  }

  return { fields: out, secrets };
}

/**
 * "locked" and "missing" mean the file names a credential the runtime cannot produce, so the server
 * would only answer 401. A locked one needs the authenticator, a missing one needs typing.
 */
export type SecretFieldState = "editing" | "locked" | "missing" | "saved" | "empty";

export function secretFieldState(
  fileValue: string,
  typed: string | undefined,
  knownSecrets: string[],
  lockedSecrets: string[],
): SecretFieldState {
  if (typed !== undefined) return "editing";
  const name = envSecretName(fileValue);
  if (name === "") return "empty";
  if (lockedSecrets.includes(name)) return "locked";
  return knownSecrets.includes(name) ? "saved" : "missing";
}

/** What stands between this server and a connection, if anything. */
export function credentialNeed(states: SecretFieldState[]): "none" | "locked" | "missing" {
  if (states.includes("locked")) return "locked";
  if (states.includes("missing")) return "missing";
  return "none";
}
