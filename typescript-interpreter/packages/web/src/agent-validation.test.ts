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
import { getSection, setSection } from "./pages/workspace/agent-source-edit";
import { buildableAgent, previewAgent } from "./agent-validation";

const FILE = `---
name: Code explain Agent
model:
  provider: anthropic
  name: claude-sonnet-5
---

# Role

You are a helper.

# Instructions

Answer clearly.
`;

/**
 * Clearing a field to retype it is the most ordinary edit there is, and it must not take the
 * Build view away along with the box being typed into.
 */
describe("the Build view stays put while a field is empty", () => {
  for (const field of ["Role", "Instructions"] as const) {
    it(`survives ${field} being cleared`, () => {
      const cleared = setSection(FILE, field, "");
      expect(buildableAgent(cleared).ok).toBe(true);
      expect(getSection(cleared, field)).toBe("");
    });

    it(`lets ${field} be typed back in`, () => {
      const cleared = setSection(FILE, field, "");
      const retyped = setSection(cleared, field, "A poet.");
      expect(getSection(retyped, field)).toBe("A poet.");
      // Typed all the way back in, the file runs again.
      expect(previewAgent(retyped).ok).toBe(true);
    });

    it(`keeps the other section intact while ${field} is empty`, () => {
      const other = field === "Role" ? "Instructions" : "Role";
      const before = getSection(FILE, other);
      expect(getSection(setSection(FILE, field, ""), other)).toBe(before);
    });
  }

  it("survives both being empty at once, settings and all", () => {
    const drawable = buildableAgent(setSection(setSection(FILE, "Role", ""), "Instructions", ""));
    expect(drawable.ok).toBe(true);
    // The name and the model still read, so the agent keeps its identity and its diagram while
    // the two boxes are empty.
    if (drawable.ok) {
      expect(drawable.metadata.name).toBe("Code explain Agent");
      expect(drawable.metadata.model?.name).toBe("claude-sonnet-5");
    }
  });

  // Running is a different question from drawing, and it stays strict: an agent with no role
  // is not one you can run.
  it("still refuses to run a file with no role", () => {
    expect(previewAgent(setSection(FILE, "Role", "")).ok).toBe(false);
  });

  // The one thing the diagram genuinely cannot draw is settings it cannot read.
  it("falls back to Raw only when the settings block is broken", () => {
    expect(buildableAgent("---\nmodel: [not, a, map]\n---\n\n# Role\n\nx\n").ok).toBe(false);
  });
});
