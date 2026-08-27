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
import { getModelField, setModelField, getModelApiKey, setModelApiKey, setServerToolFilter, agentBrief, envSecretName, getFrontmatterScalar, addMcpServer, removeMcpServer, getSection, setSection } from "./agent-source-edit";
import { previewAgent } from "../../agent-validation";

const FULL = `---
name: Tester
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:OPENAI_API_KEY}
tools:
  mcp:
    - name: deepwiki
      transport:
        type: http
---

# Role
r
`;

describe("model frontmatter editing", () => {
  it("reads the model's own provider and name", () => {
    expect(getModelField(FULL, "provider")).toBe("openai");
    expect(getModelField(FULL, "name")).toBe("gpt-4o");
  });

  it("does not confuse an MCP server's name with the model's name", () => {
    // `name: deepwiki` sits outside the model block; `type:` sits deeper inside it.
    expect(getModelField(FULL, "name")).not.toBe("deepwiki");
  });

  it("rewrites only the target line", () => {
    const next = setModelField(FULL, "name", "claude-opus-5");
    expect(getModelField(next, "name")).toBe("claude-opus-5");
    expect(getModelField(next, "provider")).toBe("openai");
    expect(next).toContain("api_key: ${env:OPENAI_API_KEY}");
    expect(next).toContain("- name: deepwiki");
    expect(next.split("\n").length).toBe(FULL.split("\n").length);
  });

  it("keeps the body and the rest of the frontmatter byte-identical", () => {
    const next = setModelField(FULL, "provider", "anthropic");
    expect(next.slice(next.indexOf("# Role"))).toBe(FULL.slice(FULL.indexOf("# Role")));
    expect(next).toContain("  provider: anthropic\n");
  });

  it("adds the key when the model block does not have it yet", () => {
    const source = "---\nname: Tester\nmodel:\n  provider: openai\n---\n\n# Role\nr\n";
    const next = setModelField(source, "name", "gpt-4o");
    expect(getModelField(next, "name")).toBe("gpt-4o");
    expect(getModelField(next, "provider")).toBe("openai");
  });

  it("creates the whole model block when the file has none", () => {
    const source = "---\nname: Tester\n---\n\n# Role\nr\n";
    const next = setModelField(source, "provider", "anthropic");
    expect(next).toContain("model:\n  provider: anthropic");
    expect(getModelField(next, "provider")).toBe("anthropic");
  });

  it("preserves a four-space indent style", () => {
    const source = "---\nmodel:\n    provider: openai\n    name: gpt-4o\n---\n\n# Role\nr\n";
    const next = setModelField(source, "name", "gpt-4o-mini");
    expect(next).toContain("    name: gpt-4o-mini");
    expect(next).not.toContain("  name: gpt-4o-mini\n  ");
  });

  it("writes an empty value as an empty string, never as YAML null", () => {
    // A bare `name:` parses as null and fails validation, which would collapse the Simple
    // view the moment the model field is cleared.
    const next = setModelField(FULL, "name", "");
    expect(next).toContain('name: ""');
    expect(next).not.toMatch(/^ +name:\s*$/m);
    expect(getModelField(next, "name")).toBe("");
  });

  it("quotes a value that would otherwise change the YAML shape", () => {
    const next = setModelField(FULL, "name", "weird: model");
    expect(next).toContain('name: "weird: model"');
    expect(getModelField(next, "name")).toBe("weird: model");
  });

  it("leaves an inline `model:` shorthand alone rather than rewriting its shape", () => {
    const source = "---\nname: Tester\nmodel: gpt-4o\n---\n\n# Role\nr\n";
    // Nothing here matches the nested mapping these controls edit, so a new block is added
    // rather than the existing scalar being silently reinterpreted.
    expect(getModelField(source, "name")).toBe("");
  });

  it("returns empty for a file with no frontmatter", () => {
    expect(getModelField("# Role\nr\n", "provider")).toBe("");
    expect(setModelField("# Role\nr\n", "provider", "openai")).toBe("# Role\nr\n");
  });
});

describe("model api_key editing", () => {
  it("reads api_key from inside the authentication mapping", () => {
    expect(getModelApiKey(FULL)).toBe("${env:OPENAI_API_KEY}");
  });

  it("rewrites only the api_key line, leaving the rest of the file alone", () => {
    const next = setModelApiKey(FULL, "${env:ANTHROPIC_API_KEY}");
    expect(next).toContain("    api_key: ${env:ANTHROPIC_API_KEY}");
    expect(next).toContain("    type: api-key");
    expect(next).toContain("      transport:");
    expect(getModelField(next, "name")).toBe("gpt-4o");
  });

  it("keeps the author's quoting style", () => {
    const quoted = FULL.replace("api_key: ${env:OPENAI_API_KEY}", 'api_key: "${env:OPENAI_API_KEY}"');
    expect(setModelApiKey(quoted, "${env:ANTHROPIC_API_KEY}")).toContain('api_key: "${env:ANTHROPIC_API_KEY}"');
  });

  it("ignores an api_key belonging to a tool server, not the model", () => {
    const toolKey = `---
name: Tester
model:
  provider: openai
  name: gpt-4o
tools:
  mcp:
    - name: svc
      transport:
        authentication:
          api_key: \${env:TOOL_KEY}
---

# Role
r
`;
    expect(getModelApiKey(toolKey)).toBe("");
    const next = setModelApiKey(toolKey, "${env:ANTHROPIC_API_KEY}");
    // The server's own key is left exactly where it was; only the model gains one.
    expect(next).toContain("api_key: ${env:TOOL_KEY}");
    expect(getModelApiKey(next)).toBe("${env:ANTHROPIC_API_KEY}");
  });

  // The block is created rather than skipped: writing nothing would make choosing a provider
  // look like it had worked while the file still pointed at nobody's key.
  it("creates the authentication block when the file has none", () => {
    const bare = "---\nname: T\nmodel:\n  provider: openai\n  name: gpt-4o\n---\n\n# Role\nr\n";
    const next = setModelApiKey(bare, "${env:ANTHROPIC_API_KEY}");
    expect(getModelApiKey(next)).toBe("${env:ANTHROPIC_API_KEY}");
    expect(next).toContain("type: api-key");
  });
});

const WITH_SERVERS = `---
name: Foreman
model:
  provider: anthropic
  name: claude-sonnet-5
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
r
`;

describe("setServerToolFilter", () => {
  it("adds an allow-list to the named server only", () => {
    const next = setServerToolFilter(WITH_SERVERS, "gitlab", ["list_issues", "get_issue"]);
    expect(next).toContain("      tool_filter:\n        allow:\n          - list_issues\n          - get_issue");
    // the other server is untouched
    expect(next).toContain("    - name: deepwiki\n      transport:");
  });

  it("keeps every other line of the file exactly as it was", () => {
    const next = setServerToolFilter(WITH_SERVERS, "gitlab", ["list_issues"]);
    expect(next).toContain("url: https://gitlab.com/api/v4/mcp");
    expect(next).toContain("# Role");
    expect(next).toContain("name: claude-sonnet-5");
  });

  it("replaces an allow-list that is already there rather than adding a second", () => {
    const once = setServerToolFilter(WITH_SERVERS, "gitlab", ["a", "b"]);
    const twice = setServerToolFilter(once, "gitlab", ["c"]);
    expect(twice.match(/tool_filter:/g)).toHaveLength(1);
    expect(twice).toContain("- c");
    expect(twice).not.toContain("- a");
  });

  it("removes the block when nothing is filtered out", () => {
    const once = setServerToolFilter(WITH_SERVERS, "gitlab", ["a"]);
    const cleared = setServerToolFilter(once, "gitlab", null);
    expect(cleared).not.toContain("tool_filter");
    expect(cleared).toContain("- name: gitlab");
  });

  it("writes to the second server without disturbing the first", () => {
    const next = setServerToolFilter(WITH_SERVERS, "deepwiki", ["search"]);
    const gitlabPart = next.slice(next.indexOf("- name: gitlab"), next.indexOf("- name: deepwiki"));
    expect(gitlabPart).not.toContain("tool_filter");
    expect(next.slice(next.indexOf("- name: deepwiki"))).toContain("tool_filter");
  });

  it("leaves a file alone when the server is not in it", () => {
    expect(setServerToolFilter(WITH_SERVERS, "nope", ["a"])).toBe(WITH_SERVERS);
  });

  it("leaves a file with no tools block alone", () => {
    const plain = "---\nname: T\n---\n\n# Role\nr\n";
    expect(setServerToolFilter(plain, "gitlab", ["a"])).toBe(plain);
  });
});

describe("reading the brief and the key it points at", () => {
  const file = ['---', 'name: a', 'model:', '  provider: anthropic', '  authentication:',
    '    api_key: ${env:MY_OWN_KEY}', '---', '', '# Role', '', 'A helper.', ''].join("\n");

  it("treats the prose below the frontmatter as the brief", () => {
    expect(agentBrief(file)).toBe("# Role\n\nA helper.");
  });

  // Changing the model must not count as rewriting the agent, or every model swap would throw
  // the conversation away.
  it("ignores frontmatter changes", () => {
    expect(agentBrief(file.replace("anthropic", "openai"))).toBe(agentBrief(file));
  });

  it("notices a rewritten role", () => {
    expect(agentBrief(file.replace("A helper.", "A poet."))).not.toBe(agentBrief(file));
  });

  // The catalogue name is a guess; the file is the fact. Guessing reports a saved, working key
  // as missing and asks for it again.
  it("reads the key name the file actually points at", () => {
    expect(envSecretName(getModelApiKey(file))).toBe("MY_OWN_KEY");
  });

  it("returns nothing for a key that is not an env reference", () => {
    expect(envSecretName("sk-literal-key")).toBe("");
  });
});

// YAML quotes both ways. Only the double-quoted form is JSON-compatible, so a single-quoted
// scalar has to be unwrapped here or its quotes are written back into the file.
describe("quoted scalars", () => {
  const file = (body: string) => `---\n${body}\n---\n\n# Role\nr\n\n# Instructions\ni\n`;

  it("reads a double-quoted value", () => {
    expect(getFrontmatterScalar(file(`name: "My Agent"`), "name")).toBe("My Agent");
  });

  it("reads a single-quoted value", () => {
    expect(getFrontmatterScalar(file(`name: 'My Agent'`), "name")).toBe("My Agent");
  });

  it("unescapes a doubled quote inside a single-quoted value", () => {
    expect(getFrontmatterScalar(file(`name: 'It''s mine'`), "name")).toBe("It's mine");
  });

  it("leaves an unquoted value alone", () => {
    expect(getFrontmatterScalar(file("name: My Agent"), "name")).toBe("My Agent");
  });

  it("applies the same rules inside the model block", () => {
    expect(getModelField(file("model:\n  provider: 'anthropic'"), "provider")).toBe("anthropic");
    expect(getModelField(file('model:\n  name: "claude-opus-5"'), "name")).toBe("claude-opus-5");
  });

  it("does not mistake an apostrophe for a quoted value", () => {
    expect(getFrontmatterScalar(file("description: it's fine"), "description")).toBe("it's fine");
  });
});

describe("a file with blank lines before the opening fence", () => {
  const source = `\n\n${FULL}`;

  it("reads and edits the model like any other file", () => {
    expect(getModelField(source, "name")).toBe("gpt-4o");
    const next = setModelField(source, "name", "claude-opus-5");
    expect(getModelField(next, "name")).toBe("claude-opus-5");
    expect(next.startsWith("\n\n---\n")).toBe(true);
  });

  it("adds the model block inside the header, not after it", () => {
    const next = setModelField("\n---\nname: Tester\n---\n\n# Role\nr\n", "provider", "anthropic");
    expect(getModelField(next, "provider")).toBe("anthropic");
    expect(next.indexOf("model:")).toBeLessThan(next.lastIndexOf("---"));
  });

  it("finds the brief after the header", () => {
    expect(agentBrief(source)).toBe(agentBrief(FULL));
  });
});

const BARE = `---
name: Tester
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:OPENAI_API_KEY}
---

# Role

r

# Instructions

i
`;

const WITH_ONE = BARE.replace("---\n\n# Role", `tools:
  mcp:
    - name: deepwiki
      transport:
        type: http
        url: https://mcp.deepwiki.com/mcp
---

# Role`);

function servers(content: string) {
  const preview = previewAgent(content);
  if (!preview.ok) throw new Error(`invalid: ${preview.error}`);
  return preview.metadata.tools?.mcp ?? [];
}

describe("adding a server", () => {
  it("creates tools.mcp when the file has neither", () => {
    const next = addMcpServer(BARE, { name: "exa", url: "https://mcp.exa.ai/mcp" });
    const list = servers(next);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("exa");
  });

  it("appends after the servers already there, rather than inside the last one", () => {
    const next = addMcpServer(WITH_ONE, { name: "exa", url: "https://mcp.exa.ai/mcp" });
    expect(servers(next).map((s) => s.name)).toEqual(["deepwiki", "exa"]);
  });

  it("writes the auth block for the type chosen", () => {
    const next = addMcpServer(BARE, {
      name: "gitlab",
      url: "https://gitlab.com/api/v4/mcp",
      auth: {
        type: "oauth2",
        fields: {
          grant_type: "authorization_code",
          authorize_url: "https://gitlab.com/oauth/authorize",
          token_url: "https://gitlab.com/oauth/token",
          client_id: "${env:GITLAB_OAUTH_CLIENT_ID}",
        },
        scopes: ["mcp"],
      },
    });
    const server = servers(next)[0];
    expect(server?.transport.type).toBe("http");
    if (server?.transport.type !== "http") throw new Error("expected http");
    expect(server.transport.authentication?.type).toBe("oauth2");
    expect(server.transport.authentication?.client_id).toBe("${env:GITLAB_OAUTH_CLIENT_ID}");
    expect(server.transport.authentication?.scopes).toEqual(["mcp"]);
  });

  it("leaves an empty field out rather than writing a blank one", () => {
    const next = addMcpServer(BARE, {
      name: "exa",
      url: "https://mcp.exa.ai/mcp",
      auth: { type: "bearer", fields: { token: "${env:EXA_API_KEY}", header_name: "  " } },
    });
    expect(next).not.toContain("header_name");
  });

  it("round-trips: a file with a server added still parses", () => {
    const next = addMcpServer(addMcpServer(BARE, { name: "a", url: "https://a.example/mcp" }), {
      name: "b",
      url: "https://b.example/mcp",
    });
    expect(servers(next).map((s) => s.name)).toEqual(["a", "b"]);
  });
});

describe("removing a server", () => {
  it("takes the whole block, not just its name line", () => {
    const two = addMcpServer(WITH_ONE, { name: "exa", url: "https://mcp.exa.ai/mcp" });
    const next = removeMcpServer(two, "deepwiki");
    expect(servers(next).map((s) => s.name)).toEqual(["exa"]);
    expect(next).not.toContain("deepwiki");
  });

  it("leaves the file alone when the name is not there", () => {
    expect(removeMcpServer(WITH_ONE, "nope")).toBe(WITH_ONE);
  });
});

const FILE = `---
name: Tester
model:
  provider: openai
  name: gpt-4o
---

# Role

You are a tester

# Instructions

Be brief
`;

describe("typing in Role and Instructions", () => {
  // The editor round-trips through the file on every keystroke. Trimming here removed the
  // space the instant it was typed, so the next letter landed against the previous word.
  it("keeps a trailing space so the next word can be typed", () => {
    const typed = setSection(FILE, "Role", "You are a tester ");
    expect(getSection(typed, "Role")).toBe("You are a tester ");
  });

  it("keeps a leading space", () => {
    const typed = setSection(FILE, "Instructions", "  indented on purpose");
    expect(getSection(typed, "Instructions")).toBe("  indented on purpose");
  });

  it("keeps blank lines between paragraphs", () => {
    const body = "First paragraph.\n\nSecond paragraph.";
    expect(getSection(setSection(FILE, "Instructions", body), "Instructions")).toBe(body);
  });

  it("survives being typed one character at a time", () => {
    let content = FILE;
    for (const chunk of ["a", "a ", "a b", "a b ", "a b c"]) {
      content = setSection(content, "Role", chunk);
      expect(getSection(content, "Role")).toBe(chunk);
    }
  });

  it("writes the heading when the file has not got one", () => {
    const bare = "---\nname: Tester\n---\n\n# Role\n\nr\n";
    const next = setSection(bare, "Instructions", "Be brief");
    expect(getSection(next, "Instructions")).toBe("Be brief");
  });

  it("leaves the other section alone", () => {
    const next = setSection(FILE, "Role", "Changed ");
    expect(getSection(next, "Instructions")).toBe("Be brief");
  });
});

describe("removing the last server", () => {
  function ok(content: string) {
    const preview = previewAgent(content);
    if (!preview.ok) throw new Error(preview.error);
    return preview.metadata;
  }

  // An empty `mcp:` reads back as null, and the schema wants an array - which is exactly what
  // turned "delete this server" into a file that would not open.
  it("leaves a file that still parses", () => {
    const one = addMcpServer(FILE, { name: "exa", url: "https://mcp.exa.ai/mcp" });
    const none = removeMcpServer(one, "exa");
    expect(() => ok(none)).not.toThrow();
    expect(none).not.toContain("mcp:");
    expect(none).not.toContain("tools:");
  });

  it("keeps tools.mcp when another server is still there", () => {
    const two = addMcpServer(addMcpServer(FILE, { name: "a", url: "https://a.example/mcp" }), {
      name: "b",
      url: "https://b.example/mcp",
    });
    const one = removeMcpServer(two, "a");
    expect(ok(one).tools?.mcp?.map((s) => s.name)).toEqual(["b"]);
  });
});

describe("setting the model key", () => {
  // Writing nothing made choosing a provider look like it had worked while the file still
  // pointed at nobody's key.
  it("creates the authentication block when the file has none", () => {
    const next = setModelApiKey(FILE, "${env:OPENAI_API_KEY}");
    expect(getModelApiKey(next)).toBe("${env:OPENAI_API_KEY}");
    const preview = previewAgent(next);
    expect(preview.ok).toBe(true);
  });

  it("adds only the key when authentication already exists", () => {
    const withAuth = FILE.replace("  name: gpt-4o", "  name: gpt-4o\n  authentication:\n    type: api-key");
    const next = setModelApiKey(withAuth, "${env:OPENAI_API_KEY}");
    expect(getModelApiKey(next)).toBe("${env:OPENAI_API_KEY}");
    expect(next.match(/authentication:/g)).toHaveLength(1);
  });
});
