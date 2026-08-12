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
import { parseAfm, validateMetadata } from "@afm/engine";
import { stripCodeFence, buildAfmSource } from "./draft-format";

function assertValidAfm(source: string): void {
  const parsed = parseAfm(source);
  expect(() => validateMetadata(parsed.frontmatter)).not.toThrow();
}

describe("stripCodeFence", () => {
  it("removes a wrapping ```-fenced block", () => {
    expect(stripCodeFence("```\nhello\n```")).toBe("hello");
  });

  it("removes a language-tagged fence", () => {
    expect(stripCodeFence("```yaml\nhello\n```")).toBe("hello");
  });

  it("leaves unfenced text untouched (aside from trimming)", () => {
    expect(stripCodeFence("  hello  ")).toBe("hello");
  });
});

describe("buildAfmSource", () => {
  const raw = "NAME: SuperMart Manager\n\n# Role\nA supermarket manager.\n\n# Instructions\n1. Do things.\n";

  it("builds schema-correct frontmatter - interfaces as an object list, not a bare string", () => {
    const source = buildAfmSource(raw, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source).toContain("interfaces:\n  - type: webchat");
    expect(source).not.toContain("interfaces: [webchat]");
    assertValidAfm(source);
  });

  it("always closes the frontmatter with a second '---'", () => {
    const source = buildAfmSource(raw, "openai", "gpt-4o", "OPENAI_API_KEY");
    const delimiterCount = source.split("\n").filter((line) => line.trim() === "---").length;
    expect(delimiterCount).toBe(2);
    assertValidAfm(source);
  });

  it("passes real engine parsing/validation for both providers (the exact failures reported: unclosed frontmatter, interfaces.0 type error)", () => {
    assertValidAfm(buildAfmSource(raw, "openai", "gpt-4o", "OPENAI_API_KEY"));
    assertValidAfm(buildAfmSource(raw, "anthropic", "claude-sonnet-4-5", "ANTHROPIC_API_KEY"));
  });

  it("reproduces and validates the exact reported SuperMart Manager output", () => {
    const supermart =
      "NAME: SuperMart Manager\n\n" +
      "# Role\nA supermarket manager for managing products.\n\n" +
      "# Instructions\n" +
      "1. Assist in calculating bills and printing receipts for customers.\n" +
      "2. Manage product inventory by adding, deleting, and updating products.\n" +
      "3. Track inventory levels and notify when restocking is needed.\n" +
      "4. Provide sales insights and ideas to improve product sales.\n" +
      "5. Maintain a friendly and engaging tone during interactions.\n";
    const source = buildAfmSource(supermart, "openai", "gpt-4o", "OPENAI_API_KEY");
    assertValidAfm(source);
  });

  it("embeds the extracted name, quoted, and the model/secret fields", () => {
    const source = buildAfmSource(raw, "anthropic", "claude-sonnet-4-5", "ANTHROPIC_API_KEY");
    expect(source).toContain('name: "SuperMart Manager"');
    expect(source).toContain("provider: anthropic");
    expect(source).toContain("name: claude-sonnet-4-5");
    expect(source).toContain('api_key: "${env:ANTHROPIC_API_KEY}"');
  });

  it("keeps the Role/Instructions body verbatim", () => {
    const source = buildAfmSource(raw, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source).toContain("# Role\nA supermarket manager.");
    expect(source).toContain("# Instructions\n1. Do things.");
  });

  it("discards any preamble or stray YAML the model tried to add before '# Role'", () => {
    const withJunk = '---\nname: whatever\ninterfaces: [webchat]\n---\n\nNAME: X\n\n# Role\nBody.\n\n# Instructions\nDo it.';
    const source = buildAfmSource(withJunk, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source.match(/---/g)?.length).toBe(2);
    expect(source).not.toContain("whatever");
    assertValidAfm(source);
  });

  it("falls back to a safe default name when NAME: is missing", () => {
    const noName = "# Role\nBody.\n\n# Instructions\nDo it.";
    const source = buildAfmSource(noName, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source).toContain('name: "Untitled agent"');
    assertValidAfm(source);
  });

  it("safely quotes a name containing a colon (would break unquoted YAML)", () => {
    const withColon = "NAME: Support: Tier 1\n\n# Role\nBody.\n\n# Instructions\nDo it.";
    const source = buildAfmSource(withColon, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source).toContain('name: "Support: Tier 1"');
    assertValidAfm(source);
  });

  it("strips a code fence the model wrapped the whole response in", () => {
    const fenced = "```\n" + raw + "\n```";
    const source = buildAfmSource(fenced, "openai", "gpt-4o", "OPENAI_API_KEY");
    expect(source).toContain("# Role\nA supermarket manager.");
  });
});
