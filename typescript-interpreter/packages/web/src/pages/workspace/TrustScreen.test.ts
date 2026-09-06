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


import { describe, expect, it } from "vitest";
import type { AgentMetadata } from "@afm/engine";
import { toolSummary } from "./TrustScreen";

const withServers = (mcp: unknown[]) => ({ name: "A", tools: { mcp } }) as AgentMetadata;

describe("toolSummary", () => {
  it("says none when the file names no servers", () => {
    expect(toolSummary({ name: "A" } as AgentMetadata)).toBe("None");
  });

  it("names each server with the host it talks to", () => {
    const metadata = withServers([
      { name: "notes", transport: { type: "http", url: "https://mcp.example.com/mcp" } },
      { name: "stock", transport: { type: "http", url: "https://sheets.example.org/v1" } },
    ]);
    expect(toolSummary(metadata)).toBe("notes (mcp.example.com), stock (sheets.example.org)");
  });

  it("adds how many tools the file allows", () => {
    const metadata = withServers([
      { name: "notes", transport: { type: "http", url: "https://mcp.example.com/mcp" }, tool_filter: { allow: ["a", "b"] } },
      { name: "stock", transport: { type: "http", url: "https://sheets.example.org/v1" }, tool_filter: { allow: ["c"] } },
    ]);
    expect(toolSummary(metadata)).toBe("notes (mcp.example.com) · 2 tools, stock (sheets.example.org) · 1 tool");
  });

  it("leaves out a host for a server that is not reached over http", () => {
    const metadata = withServers([{ name: "local", transport: { type: "stdio", command: "run" } }]);
    expect(toolSummary(metadata)).toBe("local");
  });
});
