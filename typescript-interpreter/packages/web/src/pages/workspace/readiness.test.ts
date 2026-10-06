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
import { authorizationCodeRefreshKey, oauthProviderFrom } from "@afm/adapter-auth";
import { connectedServerUrls, readiness, serverNameByUrl, serversAwaitingToolChoice, setupPlan } from "./readiness";
import type { ReadinessInput } from "./readiness";
import { setServerToolFilter } from "./agent-source-edit";
import { previewAgent } from "../../agent-validation";
import type { AgentMetadata } from "@afm/engine";

const MODEL = { provider: "openai", name: "gpt-4o" } as AgentMetadata["model"];

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    role: "You are a helpful assistant.",
    instructions: "Answer clearly.",
    metadata: { name: "A", model: MODEL } as AgentMetadata,
    issues: [],
    steps: [],
    status: "ready",
    brokenServerIds: [],
    serverNameByUrl: new Map(),
    connectedUrls: new Set(),
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

  it("says what it will ask for first", () => {
    expect(sentence(readiness(input({ steps: [{ id: "key", label: "Key" }] })))).toBe("Ready - will ask for your key");
    expect(sentence(readiness(input({ steps: [{ id: "tools", label: "Tools" }] })))).toBe(
      "Ready - will ask which tools to allow",
    );
  });

  it("names the server that needs signing in", () => {
    const metadata = {
      name: "A",
      model: MODEL,
      tools: {
        mcp: [
          {
            name: "github",
            transport: { type: "http", url: "u1", authentication: { type: "oauth2", grant_type: "authorization_code" } },
          },
        ],
      },
    } as unknown as AgentMetadata;
    const r = readiness(input({ metadata, steps: [{ id: "signin", label: "Sign in" }] }));
    expect(sentence(r)).toBe("github needs you to sign in");
    expect(r.fix).toBe("tools");
  });

  // setupPlan() lists "signin" whenever the file uses oauth2 - it has no way to know a sign-in
  // already happened. readiness() is handed connectedUrls specifically so it can tell the two
  // apart instead of asking again for a server that already answered a real probe.
  it("does not ask to sign in again for a server that has already answered a probe", () => {
    const metadata = {
      name: "A",
      model: MODEL,
      tools: {
        mcp: [
          {
            name: "github",
            transport: { type: "http", url: "u1", authentication: { type: "oauth2", grant_type: "authorization_code" } },
          },
        ],
      },
    } as unknown as AgentMetadata;
    const r = readiness(input({ metadata, steps: [{ id: "signin", label: "Sign in" }], connectedUrls: new Set(["u1"]) }));
    expect(sentence(r)).not.toContain("sign in");
    expect(r.tone).toBe("ok");
  });

  it("names the one server still needing sign-in when another is already connected", () => {
    const metadata = {
      name: "A",
      model: MODEL,
      tools: {
        mcp: [
          {
            name: "github",
            transport: { type: "http", url: "u1", authentication: { type: "oauth2", grant_type: "authorization_code" } },
          },
          {
            name: "linear",
            transport: { type: "http", url: "u2", authentication: { type: "oauth2", grant_type: "authorization_code" } },
          },
        ],
      },
    } as unknown as AgentMetadata;
    const r = readiness(
      input({ metadata, steps: [{ id: "signin", label: "Sign in" }], connectedUrls: new Set(["u1"]) }),
    );
    expect(sentence(r)).toBe("linear needs you to sign in");
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

describe("connectedServerUrls", () => {
  const URL = "https://gitlab.com/api/v4/mcp";
  const signIn = { type: "oauth2", grant_type: "authorization_code", authorize_url: "https://gitlab.com/oauth/authorize", token_url: "https://gitlab.com/oauth/token", client_id: "abc" };
  const withServer = (transport: object): AgentMetadata =>
    ({ tools: { mcp: [{ name: "gitlab", transport }] } }) as AgentMetadata;
  const refreshKeyFor = (url: string) => authorizationCodeRefreshKey(oauthProviderFrom(signIn, url));

  it("counts a server a probe heard tools back from", () => {
    expect([...connectedServerUrls(null, [URL], [])]).toEqual([URL]);
  });

  it("counts a server whose sign-in is saved, though nothing was probed", () => {
    const metadata = withServer({ type: "http", url: URL, authentication: signIn });
    expect([...connectedServerUrls(metadata, [], [refreshKeyFor(URL)])]).toEqual([URL]);
  });

  it("does not count a sign-in that was saved for a different server", () => {
    const metadata = withServer({ type: "http", url: URL, authentication: signIn });
    expect(connectedServerUrls(metadata, [], [refreshKeyFor("https://other.example/mcp")]).size).toBe(0);
  });

  it("does not count a server that signs in by a machine grant", () => {
    const machine = { ...signIn, grant_type: "client_credentials" };
    const metadata = withServer({ type: "http", url: URL, authentication: machine });
    expect(connectedServerUrls(metadata, [], [refreshKeyFor(URL)]).size).toBe(0);
  });

  it("does not count a server that is not reached over http", () => {
    const metadata = withServer({ type: "stdio", command: "gitlab-mcp" });
    expect(connectedServerUrls(metadata, [], [refreshKeyFor(URL)]).size).toBe(0);
  });
});

function build(body: string): string {
  return `---
name: Tester
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:OPENAI_API_KEY}
${body}---

# Role

Test agent.

# Instructions

Do the thing.
`;
}

function metadataOf(content: string) {
  const preview = previewAgent(content);
  if (!preview.ok) throw new Error(`invalid: ${preview.error}`);
  return preview.metadata;
}

function ids(content: string, saved: string[] = []) {
  return setupPlan(content, metadataOf(content), saved).map((step) => step.id);
}

const OAUTH_SERVER = `tools:
  mcp:
    - name: gitlab
      transport:
        type: http
        url: https://gitlab.com/api/v4/mcp
        authentication:
          type: oauth2
          grant_type: authorization_code
          client_id: afm-test-client
          authorize_url: https://gitlab.com/oauth/authorize
          token_url: https://gitlab.com/oauth/token
`;

describe("setupPlan", () => {
  it("plans the whole run up front, not one step at a time", () => {
    expect(ids(build(OAUTH_SERVER))).toEqual(["key", "signin", "tools"]);
  });

  // "Only steps missing" - a key already on the device is not worth asking about.
  it("leaves out a key that is already saved", () => {
    expect(ids(build(OAUTH_SERVER), ["OPENAI_API_KEY"])).toEqual(["signin", "tools"]);
  });

  it("leaves out sign-in for a server that does not use interactive oauth", () => {
    const plain = `tools:
  mcp:
    - name: deepwiki
      transport:
        type: http
        url: https://mcp.deepwiki.com/mcp
`;
    expect(ids(build(plain))).toEqual(["key", "tools"]);
  });

  it("leaves out tool selection once the file records a choice", () => {
    const chosen = `tools:
  mcp:
    - name: deepwiki
      transport:
        type: http
        url: https://mcp.deepwiki.com/mcp
      tool_filter:
        allow:
          - search
`;
    expect(ids(build(chosen))).toEqual(["key"]);
  });

  it("asks for nothing when the key is saved and the tools are chosen", () => {
    const chosen = `tools:
  mcp:
    - name: deepwiki
      transport:
        type: http
        url: https://mcp.deepwiki.com/mcp
      tool_filter:
        allow:
          - search
`;
    expect(ids(build(chosen), ["OPENAI_API_KEY"])).toEqual([]);
  });

  it("plans a toolless agent as a single key step", () => {
    expect(ids(build(""))).toEqual(["key"]);
  });
});

type McpServers = NonNullable<NonNullable<AgentMetadata["tools"]>["mcp"]>;

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

// Tool descriptors identify their server by URL, never by the name in the file.
const REPORTED = ["https://gitlab.com/api/v4/mcp", "https://mcp.deepwiki.com/mcp"];

describe("tool choice", () => {
  it("maps each server URL to the name the file gives it", () => {
    expect(serverNameByUrl(servers(SOURCE))).toEqual(
      new Map([
        ["https://gitlab.com/api/v4/mcp", "gitlab"],
        ["https://mcp.deepwiki.com/mcp", "deepwiki"],
      ]),
    );
  });

  it("asks about every server that answered", () => {
    expect(serversAwaitingToolChoice(servers(SOURCE), REPORTED)).toEqual(REPORTED);
  });

  // The descriptors carry the server's URL, but the edit matches on its name, so passing one
  // straight through writes nothing and the question returns on every reload.
  it("stops asking once the choice is written back", () => {
    const nameByUrl = serverNameByUrl(servers(SOURCE));
    let next = SOURCE;
    for (const url of REPORTED) {
      next = setServerToolFilter(next, nameByUrl.get(url)!, ["search"]);
    }
    expect(next).not.toEqual(SOURCE);
    expect(serversAwaitingToolChoice(servers(next), REPORTED)).toEqual([]);
  });

  it("records an empty choice as a real empty list, not YAML null", () => {
    const next = setServerToolFilter(SOURCE, "gitlab", []);
    const gitlab = servers(next).find((server) => server.name === "gitlab");
    expect(gitlab?.tool_filter?.allow).toEqual([]);
    expect(serversAwaitingToolChoice(servers(next), REPORTED)).toEqual(["https://mcp.deepwiki.com/mcp"]);
  });

  // Unticking every tool takes the grants back, so a grant can no longer be what settles it.
  it("does not ask again after every tool was unticked", () => {
    const next = setServerToolFilter(SOURCE, "gitlab", []);
    expect(serversAwaitingToolChoice(servers(next), REPORTED, () => false)).toEqual([
      "https://mcp.deepwiki.com/mcp",
    ]);
  });

  // A server that never answered has no tools to tick, so it must not hold the chat hostage.
  it("does not ask about a server that failed to connect", () => {
    expect(serversAwaitingToolChoice(servers(SOURCE), ["https://gitlab.com/api/v4/mcp"])).toEqual([
      "https://gitlab.com/api/v4/mcp",
    ]);
  });
});

describe("an agent whose grants were filed under a different id", () => {
  const withFilter: McpServers = [
    {
      name: "deepwiki",
      transport: { type: "http", url: "https://mcp.deepwiki.com/mcp" },
      tool_filter: { allow: ["ask_question"] },
    },
  ];
  const reported = ["https://mcp.deepwiki.com/mcp"];

  it("asks once when the file says allowed but this browser holds no grant", () => {
    expect(serversAwaitingToolChoice(withFilter, reported, () => false))
      .toEqual(["https://mcp.deepwiki.com/mcp"]);
  });

  it("stays out of the way once the grant is held", () => {
    expect(serversAwaitingToolChoice(withFilter, reported, () => true)).toEqual([]);
  });

  // A server that never answered has no tools to tick, so asking about it can never be
  // satisfied - that is the loop this guard exists to prevent.
  it("never asks about a server that did not answer", () => {
    expect(serversAwaitingToolChoice(withFilter, [], () => false)).toEqual([]);
  });
});
