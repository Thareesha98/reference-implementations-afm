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
import { shareChecks } from "./SharePanel";

const done = (checks: ReturnType<typeof shareChecks>) => checks.filter((check) => check.done).map((check) => check.label);

describe("shareChecks", () => {
  it("has nothing done for an empty file", () => {
    expect(done(shareChecks(null))).toEqual([]);
  });

  it("marks each detail the file already gives", () => {
    const metadata = {
      description: "Reads papers",
      icon_url: "https://example.com/i.png",
      version: "1.0.0",
      authors: ["Ada"],
      provider: { name: "Example Co" },
      license: "MIT",
    } as AgentMetadata;
    expect(done(shareChecks(metadata))).toHaveLength(6);
  });

  it("counts blank details as missing", () => {
    const metadata = { description: "  ", authors: [], license: "", provider: {} } as AgentMetadata;
    expect(done(shareChecks(metadata))).toEqual([]);
  });
});
