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

import type { SecretPort } from "./types";
import { VariableResolutionError } from "./errors";
import { splitFrontmatter } from "./parse";

const VARIABLE = /\$\{([^}]+)\}/g;

/** Resolves `${...}` references in the string values of parsed frontmatter. */
export function resolveVariables(
  frontmatter: Record<string, unknown>,
  secrets: SecretPort,
): Promise<Record<string, unknown>> {
  return resolveValue(frontmatter, secrets) as Promise<Record<string, unknown>>;
}

// References resolve one at a time, in file order, since each may open a prompt.
async function resolveValue(value: unknown, secrets: SecretPort): Promise<unknown> {
  if (typeof value === "string") {
    return resolveText(value, secrets);
  }
  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    for (const item of value) {
      resolved.push(await resolveValue(item, secrets));
    }
    return resolved;
  }
  if (typeof value === "object" && value !== null) {
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, await resolveValue(item, secrets)]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}

async function resolveText(text: string, secrets: SecretPort): Promise<string> {
  let resolved = "";
  let cursor = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const value = await resolveReference(match[0], match[1]!, secrets);
    resolved += text.slice(cursor, match.index) + value;
    cursor = match.index + match[0].length;
  }
  return resolved + text.slice(cursor);
}

function splitReference(expression: string): { prefix: string; name: string } {
  const colon = expression.indexOf(":");
  return colon === -1
    ? { prefix: "", name: expression }
    : { prefix: expression.slice(0, colon), name: expression.slice(colon + 1) };
}

async function resolveReference(
  reference: string,
  expression: string,
  secrets: SecretPort,
): Promise<string> {
  const { prefix, name } = splitReference(expression);

  if (prefix === "http") {
    return reference;
  }
  if (prefix === "" || prefix === "env") {
    const resolution = await secrets.resolve({ prefix, name, raw: reference });
    if (resolution.status === "resolved") {
      return resolution.value;
    }
    throw new VariableResolutionError(reference, resolution.reason);
  }
  throw new VariableResolutionError(
    reference,
    `Unsupported variable prefix '${prefix}:'. Only 'env:' and 'http:' are supported.`,
  );
}

export type SecretScope = "model" | "tool" | "other";

export interface SecretUsage {
  name: string;
  scope: SecretScope;
  // Present for tool scope: where the credential would be sent.
  host?: string;
  serverName?: string;
}

// Finds every secret reference and the field it sits in, by reading the unresolved frontmatter.
export function scanSecretUsage(content: string): SecretUsage[] {
  let frontmatter: Record<string, unknown> | null;
  try {
    frontmatter = splitFrontmatter(content).frontmatter;
  } catch {
    return [];
  }
  if (frontmatter === null) {
    return [];
  }

  const found: SecretUsage[] = [];
  const seen = new Set<string>();

  function record(usage: SecretUsage): void {
    const key = `${usage.name}\u0000${usage.scope}\u0000${usage.host ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(usage);
  }

  function namesIn(value: unknown): string[] {
    if (typeof value !== "string") return [];
    const names: string[] = [];
    for (const match of value.matchAll(VARIABLE)) {
      const { prefix, name } = splitReference(match[1] ?? "");
      // http: is a runtime binding, not a stored secret.
      if (prefix !== "" && prefix !== "env") continue;
      if (name !== "") names.push(name);
    }
    return names;
  }

  function walk(value: unknown, visit: (name: string) => void): void {
    if (typeof value === "string") {
      for (const name of namesIn(value)) visit(name);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) walk(item, visit);
    }
  }

  const model = frontmatter.model;
  if (typeof model === "object" && model !== null) {
    walk((model as Record<string, unknown>).authentication, (name) => record({ name, scope: "model" }));
  }

  const tools = frontmatter.tools;
  const servers =
    typeof tools === "object" && tools !== null && Array.isArray((tools as Record<string, unknown>).mcp)
      ? ((tools as Record<string, unknown>).mcp as unknown[])
      : [];

  for (const server of servers) {
    if (typeof server !== "object" || server === null) continue;
    const entry = server as Record<string, unknown>;
    const transport = typeof entry.transport === "object" && entry.transport !== null
      ? (entry.transport as Record<string, unknown>)
      : {};
    const serverName = typeof entry.name === "string" ? entry.name : undefined;
    const host = hostOf(transport.url);

    walk(transport.authentication, (name) => record({ name, scope: "tool", host, serverName }));
  }

  // Names outside the credential fields are reported too, so callers can list every one.
  const credentialNames = new Set(found.map((usage) => usage.name));
  walk(frontmatter, (name) => {
    if (credentialNames.has(name)) return;
    record({ name, scope: "other" });
  });

  return found;
}

function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Every distinct variable name the frontmatter refers to, whatever it is used for. */
export function referencedSecretNames(content: string): string[] {
  return [...new Set(scanSecretUsage(content).map((usage) => usage.name))];
}

// Approvals are stored as NAME@host, so a secret approved for one server is not reused for another.
export function secretUseKey(name: string, host: string | undefined): string {
  return `${name}@${host ?? "unknown"}`;
}
