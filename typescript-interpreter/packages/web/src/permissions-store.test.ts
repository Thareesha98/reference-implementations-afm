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

import { describe, it, expect } from "vitest";
import { grantsToRevoke, permissionScopeFor } from "./permissions-store";
import type { PermissionEntry } from "./permissions-store";

const SOURCE = "---\nname: Demo\n---\n\n# Role\nr\n\n# Instructions\ni\n";

describe("grantsToRevoke", () => {
  const A = "https://a.example/mcp";
  const B = "https://b.example/mcp";
  const entry = (toolName: string, serverId: string | undefined, rule: PermissionEntry["rule"] = "auto-allow"): PermissionEntry => ({
    agentId: "agent:1",
    toolName,
    serverId,
    rule,
    risk: "read",
    updatedAt: 0,
  });

  it("takes back the grant of a tool that is no longer allowed", () => {
    const entries = [entry("search", A), entry("fetch", A)];
    expect(grantsToRevoke(entries, A, ["search"]).map((e) => e.toolName)).toEqual(["fetch"]);
  });

  it("takes back every grant on the server when nothing is allowed", () => {
    const entries = [entry("search", A), entry("fetch", A)];
    expect(grantsToRevoke(entries, A, [])).toEqual(entries);
  });

  it("leaves another server's grant alone, even for a tool of the same name", () => {
    expect(grantsToRevoke([entry("search", B)], A, [])).toEqual([]);
  });

  it("leaves alone what already asks, and entries that belong to no server", () => {
    const entries = [entry("search", A, "always-ask"), entry("fetch", undefined)];
    expect(grantsToRevoke(entries, A, [])).toEqual([]);
  });
});

describe("permissionScopeFor", () => {
  // Choosing tools writes tool_filter into the file, so a content-hash scope would change on
  // every run and orphan every remembered permission.
  it("survives an edit to the agent file", () => {
    const before = permissionScopeFor("agent-1", SOURCE);
    const after = permissionScopeFor("agent-1", SOURCE + "\ntool_filter added\n");
    expect(after).toBe(before);
  });

  it("keeps two saved agents apart", () => {
    expect(permissionScopeFor("agent-1", SOURCE)).not.toBe(permissionScopeFor("agent-2", SOURCE));
  });

  it("falls back to the text for an agent that was never saved", () => {
    expect(permissionScopeFor(null, SOURCE)).toMatch(/^content:/);
    expect(permissionScopeFor(null, SOURCE)).not.toBe(permissionScopeFor(null, SOURCE + "x"));
  });
});
