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

import { loadJsonArray, saveJson } from "./local-json-store";

export type PermissionRule = "auto-allow" | "always-ask";

export interface PermissionEntry {
  agentId: string;
  toolName: string;
  // Absent on entries saved before permissions were scoped to a server. They are ignored, not
  // migrated: guessing the server would re-grant a decision the user never made for it.
  serverId?: string;
  rule: PermissionRule;
  risk: "read" | "write";
  updatedAt: number;
}

const PERMISSIONS_KEY = "afm.permissions.v1";

export function loadPermissions(): PermissionEntry[] {
  return loadJsonArray<PermissionEntry>(PERMISSIONS_KEY);
}

// A failed write must not fail the call, so the result of saveJson is ignored.
function persist(entries: PermissionEntry[]): PermissionEntry[] {
  saveJson(PERMISSIONS_KEY, entries);
  return entries;
}

export function setPermission(
  agentId: string,
  toolName: string,
  rule: PermissionRule,
  risk: "read" | "write",
  serverId?: string,
): PermissionEntry[] {
  const rest = loadPermissions().filter(
    (e) => !(e.agentId === agentId && e.toolName === toolName && e.serverId === serverId),
  );
  return persist([...rest, { agentId, toolName, serverId, rule, risk, updatedAt: Date.now() }]);
}

export function resetPermissions(agentId?: string): PermissionEntry[] {
  if (agentId === undefined) return persist([]);
  return persist(loadPermissions().filter((e) => e.agentId !== agentId));
}

// A tool unticked on a server is no longer offered, but its grant stays on file and would apply
// again if it were offered later. These are the grants to take back.
export function grantsToRevoke(entries: PermissionEntry[], serverId: string, allowed: string[]): PermissionEntry[] {
  return entries.filter(
    (entry) => entry.serverId === serverId && entry.rule === "auto-allow" && !allowed.includes(entry.toolName),
  );
}

function agentKeyFor(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (Math.imul(31, hash) + content.charCodeAt(i)) | 0;
  }
  return `content:${hash}`;
}

/**
 * Which agent a remembered permission belongs to: the library id when there is one (it survives
 * edits), otherwise the text, for an agent that has never been saved.
 */
export function permissionScopeFor(agentId: string | null, content: string): string {
  return agentId !== null ? `agent:${agentId}` : agentKeyFor(content);
}

export type ToolRisk = "read" | "write";

const READ_WORDS = ["get", "list", "read", "fetch", "search", "query", "describe", "show", "view", "find", "lookup"];
const WRITE_WORDS = [
  "write",
  "delete",
  "remove",
  "create",
  "update",
  "modify",
  "send",
  "post",
  "put",
  "patch",
  "execute",
  "run",
  "insert",
  "drop",
  "set",
  "edit",
  "publish",
  "deploy",
];

function matchesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function classifyToolRisk(name: string, description?: string): ToolRisk {
  const text = `${name} ${description ?? ""}`.toLowerCase();
  if (matchesAny(text, WRITE_WORDS)) return "write";
  if (matchesAny(text, READ_WORDS)) return "read";
  return "write";
}
