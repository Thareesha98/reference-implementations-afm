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
import type { NewMcpServer } from "./agent-source-edit";

const SECRET_SUFFIX: Record<string, string> = {
  token: "_TOKEN",
  password: "_PASSWORD",
  api_key: "_API_KEY",
};

export function isSecretAuthField(fieldKey: string): boolean {
  return SECRET_SUFFIX[fieldKey] !== undefined;
}

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
  fields: Record<string, string>;
  secrets: { name: string; value: string }[];
}

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

export type SecretFieldState = "editing" | "missing" | "saved" | "empty";

export function secretFieldState(fileValue: string, typed: string | undefined, knownSecrets: string[]): SecretFieldState {
  if (typed !== undefined) return "editing";
  const name = envSecretName(fileValue);
  if (name === "") return "empty";
  return knownSecrets.includes(name) ? "saved" : "missing";
}

export function lacksRequiredField(fields: readonly { key: string; required: boolean }[], auth: NewMcpServer["auth"]): boolean {
  return fields.some((field) => field.required && auth?.fields[field.key] === undefined);
}
