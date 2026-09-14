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
import { aboutRows } from "./InfoPanel";

const value = (rows: ReturnType<typeof aboutRows>, label: string) => rows.find((row) => row.label === label)?.value;

describe("aboutRows", () => {
  it("has nothing to show when the settings cannot be read", () => {
    expect(aboutRows(null).map((row) => row.value)).toEqual([null, null, null, null]);
  });

  it("reads each detail from the file", () => {
    const metadata = {
      name: "A",
      version: "1.2.0",
      authors: ["Ada", "Lin"],
      provider: { name: "Example Co", url: "https://example.com" },
      license: "Apache-2.0",
    } as AgentMetadata;
    const rows = aboutRows(metadata);
    expect(value(rows, "Version")).toBe("1.2.0");
    expect(value(rows, "Authors")).toBe("Ada, Lin");
    expect(value(rows, "Provider")).toBe("Example Co");
    expect(value(rows, "License")).toBe("Apache-2.0");
  });

  it("falls back to the provider's host when it has no name", () => {
    const metadata = { name: "A", provider: { url: "https://example.com/about" } } as AgentMetadata;
    expect(value(aboutRows(metadata), "Provider")).toBe("example.com");
  });

  it("counts blank or empty details as not set", () => {
    const metadata = { name: "A", version: "  ", authors: [], license: "" } as AgentMetadata;
    expect(aboutRows(metadata).map((row) => row.value)).toEqual([null, null, null, null]);
  });
});
