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
import { readiness, serverNameByUrl } from "./readiness";
import type { ReadinessInput } from "./readiness";
import { previewAgent } from "../../agent-validation";
import type { AgentMetadata } from "@afm/engine";

const MODEL = { provider: "openai", name: "gpt-4o" } as AgentMetadata["model"];

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    role: "You are a helpful assistant.",
    instructions: "Answer clearly.",
    metadata: { name: "A", model: MODEL } as AgentMetadata,
    issues: [],
    status: "ready",
    current: false,
    failed: false,
    brokenServerIds: [],
    serverNameByUrl: new Map(),
    ...over,
  };
}

const sentence = (r: ReturnType<typeof readiness>) => `${r.lead}${r.subject ?? ""}${r.tail ?? ""}`;

describe("readiness", () => {
  it("says it is ready when nothing is missing", () => {
    const r = readiness(input());
    expect(r.tone).toBe("ok");
    expect(sentence(r)).toBe("Ready");
  });

  it("does not mention how many tools it has", () => {
    const metadata = {
      name: "A",
      model: MODEL,
      tools: {
        mcp: [
          { name: "web", transport: { type: "http", url: "u1" }, tool_filter: { allow: ["a", "b"] } },
          { name: "stock", transport: { type: "http", url: "u2" }, tool_filter: { allow: ["c"] } },
        ],
      },
    } as unknown as AgentMetadata;
    expect(sentence(readiness(input({ metadata })))).toBe("Ready");
  });

  it("names a missing role before anything else", () => {
    const r = readiness(input({ role: "   ", instructions: "" }));
    expect(r.tone).toBe("bad");
    expect(sentence(r)).toBe("Needs a role before it can run");
    expect(r.fix).toBeUndefined();
  });

  it("sends a missing model to the model panel", () => {
    const metadata = { name: "A", model: { provider: "openai", name: "" } } as AgentMetadata;
    const r = readiness(input({ metadata }));
    expect(r.fix).toBe("model");
    expect(sentence(r)).toBe("Needs a model before it can run - choose one");
  });

  it("words a missing role itself rather than repeating the validator", () => {
    const r = readiness(
      input({
        role: "",
        issues: [{ severity: "error", message: "Missing required '# Role' section", field: "", line: 3 }],
      }),
    );
    expect(sentence(r)).toBe("Needs a role before it can run");
  });

  it("sends any other file error to the file", () => {
    const r = readiness(input({ issues: [{ severity: "error", message: "tools.mcp must be a list", field: "tools", line: 8 }] }));
    expect(r.fix).toBe("raw");
    expect(sentence(r)).toBe("Has a problem - tools.mcp must be a list");
  });

  it("ignores warnings", () => {
    const r = readiness(input({ issues: [{ severity: "warning", message: "no description", field: "", line: null }] }));
    expect(r.tone).toBe("ok");
  });

  it("reports the server that went quiet while running", () => {
    const r = readiness(
      input({
        status: "streaming",
        brokenServerIds: ["https://gh/mcp"],
        serverNameByUrl: new Map([["https://gh/mcp", "github"]]),
      }),
    );
    expect(r.tone).toBe("bad");
    expect(sentence(r)).toBe("Running - github did not answer");
  });

  it("says it is running once the agent on screen has started", () => {
    expect(sentence(readiness(input({ current: true })))).toBe("Running");
  });

  it("goes back to ready when the file has changed since the run", () => {
    expect(sentence(readiness(input({ current: false })))).toBe("Ready");
  });

  it("does not call an agent that failed to start running", () => {
    expect(sentence(readiness(input({ current: false, failed: true, status: "not-ready" })))).not.toBe("Running");
  });

  it("says the agent did not start, and takes the person to the chat to see why", () => {
    const r = readiness(input({ failed: true, status: "not-ready" }));
    expect(r.tone).toBe("bad");
    expect(sentence(r)).toBe("Did not start - see why");
    expect(r.fix).toBe("chat");
  });

  it("leaves out a failure that belongs to an earlier version of the file", () => {
    expect(sentence(readiness(input({ failed: false, status: "not-ready" })))).toBe("Ready");
  });

  it("names a problem in the file before saying the agent did not start", () => {
    expect(sentence(readiness(input({ failed: true, status: "not-ready", role: "" })))).toBe("Needs a role before it can run");
  });

  it("says what a healthy run is doing", () => {
    expect(sentence(readiness(input({ status: "streaming" })))).toBe("Running - waiting on the model");
  });

  it("reports unreadable settings rather than guessing", () => {
    const r = readiness(input({ metadata: null }));
    expect(r.tone).toBe("bad");
    expect(r.fix).toBe("raw");
  });

  it("words missing instructions itself too", () => {
    const r = readiness(
      input({
        instructions: "  ",
        issues: [{ severity: "error", message: "Missing required '# Instructions' section", field: "", line: 5 }],
      }),
    );
    expect(r.tone).toBe("bad");
    expect(sentence(r)).toBe("Needs instructions before it can run");
  });

  it("asks for the role before the instructions", () => {
    expect(sentence(readiness(input({ role: "", instructions: "" })))).toBe("Needs a role before it can run");
  });
});

const SOURCE = `---
name: Tester
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:OPENAI_API_KEY}
tools:
  mcp:
    - name: gitlab
      transport:
        type: http
        url: https://gitlab.com/api/v4/mcp
    - name: deepwiki
      transport:
        type: http
        url: https://mcp.deepwiki.com/mcp
---

# Role

Test agent.

# Instructions

Do the thing.
`;

function servers(content: string) {
  const preview = previewAgent(content);
  if (!preview.ok) throw new Error(`invalid: ${preview.error}`);
  return preview.metadata.tools?.mcp ?? [];
}

describe("serverNameByUrl", () => {
  it("maps each server URL to the name the file gives it", () => {
    expect(serverNameByUrl(servers(SOURCE))).toEqual(
      new Map([
        ["https://gitlab.com/api/v4/mcp", "gitlab"],
        ["https://mcp.deepwiki.com/mcp", "deepwiki"],
      ]),
    );
  });
});
