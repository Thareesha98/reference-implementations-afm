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
import { captureAuthSecrets, isSecretAuthField, lacksRequiredField, mcpSecretEnvName, secretFieldState } from "./mcp-secret-fields";
import { addMcpServer } from "./agent-source-edit";
import { prepareServerSave } from "./server-config";
import { referencedSecretNames } from "@afm/engine";

describe("isSecretAuthField", () => {
  it("is true for the fields that hold a credential", () => {
    expect(["token", "password", "api_key"].every(isSecretAuthField)).toBe(true);
  });

  it("is false for the fields that only describe how to connect", () => {
    const config = ["username", "header_name", "authorize_url", "token_url", "client_id", "scopes"];
    expect(config.some(isSecretAuthField)).toBe(false);
  });
});

describe("mcpSecretEnvName", () => {
  it("names a secret after its server and its field", () => {
    expect(mcpSecretEnvName("huggingface", "token", [])).toBe("HUGGINGFACE_TOKEN");
  });

  it("uses the right suffix per field", () => {
    expect(mcpSecretEnvName("acme", "token", [])).toBe("ACME_TOKEN");
    expect(mcpSecretEnvName("acme", "password", [])).toBe("ACME_PASSWORD");
    expect(mcpSecretEnvName("acme", "api_key", [])).toBe("ACME_API_KEY");
  });

  it("turns anything that is not a letter or digit into a single underscore", () => {
    expect(mcpSecretEnvName("my-server.example", "token", [])).toBe("MY_SERVER_EXAMPLE_TOKEN");
    expect(mcpSecretEnvName("a  b", "token", [])).toBe("A_B_TOKEN");
  });

  it("does not leave a leading or trailing underscore", () => {
    expect(mcpSecretEnvName("-edge-", "token", [])).toBe("EDGE_TOKEN");
    expect(mcpSecretEnvName("!!!", "token", [])).toBe("MCP_TOKEN");
  });

  it("steps aside from a name already spoken for", () => {
    expect(mcpSecretEnvName("acme", "token", ["ACME_TOKEN"])).toBe("ACME_TOKEN_2");
    expect(mcpSecretEnvName("acme", "token", ["ACME_TOKEN", "ACME_TOKEN_2"])).toBe("ACME_TOKEN_3");
  });

  it("ignores names that do not clash", () => {
    expect(mcpSecretEnvName("acme", "token", ["OTHER_TOKEN", "ACME_PASSWORD"])).toBe("ACME_TOKEN");
  });
});

describe("captureAuthSecrets", () => {
  it("takes a typed token out of the file and leaves a reference", () => {
    const { fields, secrets } = captureAuthSecrets("huggingface", { token: "hf_realvalue" }, []);
    expect(fields).toEqual({ token: "${env:HUGGINGFACE_TOKEN}" });
    expect(secrets).toEqual([{ name: "HUGGINGFACE_TOKEN", value: "hf_realvalue" }]);
  });

  it("leaves the fields that are not credentials exactly as typed", () => {
    const { fields, secrets } = captureAuthSecrets(
      "acme",
      { username: "alice", password: "hunter2" },
      [],
    );
    expect(fields.username).toBe("alice");
    expect(fields.password).toBe("${env:ACME_PASSWORD}");
    expect(secrets).toEqual([{ name: "ACME_PASSWORD", value: "hunter2" }]);
  });

  it("never captures an oauth2 block, which holds no credential of its own", () => {
    const oauth = {
      authorize_url: "https://a/authorize",
      token_url: "https://a/token",
      client_id: "public-id",
      grant_type: "authorization_code",
    };
    const { fields, secrets } = captureAuthSecrets("acme", oauth, []);
    expect(fields).toEqual(oauth);
    expect(secrets).toEqual([]);
  });

  it("keeps a reference the file already had, so re-saving does not rename it", () => {
    const { fields, secrets } = captureAuthSecrets("acme", { token: "${env:MY_OWN_NAME}" }, []);
    expect(fields.token).toBe("${env:MY_OWN_NAME}");
    expect(secrets).toEqual([]);
  });

  it("steps aside from a name the file already uses elsewhere", () => {
    const { fields, secrets } = captureAuthSecrets("acme", { token: "raw" }, ["ACME_TOKEN"]);
    expect(fields.token).toBe("${env:ACME_TOKEN_2}");
    expect(secrets[0]?.name).toBe("ACME_TOKEN_2");
  });

  it("returns nothing to store when there is nothing sensitive", () => {
    const { secrets } = captureAuthSecrets("acme", { header_name: "X-API-Key" }, []);
    expect(secrets).toEqual([]);
  });
});

describe("secretFieldState", () => {
  const ref = "${env:HUGGINGFACE_TOKEN}";

  it("is saved once the worker can answer for the name, sealed or not", () => {
    expect(secretFieldState(ref, undefined, ["HUGGINGFACE_TOKEN"])).toBe("saved");
  });

  it("is missing when the file references a name nobody has", () => {
    expect(secretFieldState(ref, undefined, [])).toBe("missing");
  });

  it("is empty when the file holds no reference at all", () => {
    expect(secretFieldState("", undefined, ["HUGGINGFACE_TOKEN"])).toBe("empty");
    expect(secretFieldState("a-raw-legacy-value", undefined, [])).toBe("empty");
  });

  it("is editing the moment the user touches the box, whatever is stored", () => {
    expect(secretFieldState(ref, "new", ["HUGGINGFACE_TOKEN"])).toBe("editing");
    expect(secretFieldState(ref, "", ["HUGGINGFACE_TOKEN"])).toBe("editing");
  });
});

const FILE = `---
name: Tester
model:
  provider: anthropic
  authentication:
    type: api-key
    api_key: \${env:ANTHROPIC_API_KEY}
---

# Role
r

# Instructions
i
`;

function save(
  content: string,
  server: { name: string; url: string; type: string; fields: Record<string, string> },
  editing: string | null = null,
): { content: string; stored: { name: string; value: string }[] } {
  const next = prepareServerSave({
    content,
    editing,
    server: { name: server.name, url: server.url, auth: { type: server.type, fields: server.fields } },
    knownSecrets: [],
    tools: null,
    allowed: [],
  });
  return { content: next.content, stored: next.secrets };
}

describe("adding an MCP server that needs a credential", () => {
  const bearer = {
    name: "huggingface",
    url: "https://hf.co/mcp",
    type: "bearer",
    fields: { token: "hf_a_real_token_value" },
  };

  it("never writes the credential into the agent file", () => {
    const { content } = save(FILE, bearer);
    expect(content).not.toContain("hf_a_real_token_value");
    expect(content).toContain("${env:HUGGINGFACE_TOKEN}");
  });

  it("hands the credential over to be stored instead", () => {
    const { stored } = save(FILE, bearer);
    expect(stored).toEqual([{ name: "HUGGINGFACE_TOKEN", value: "hf_a_real_token_value" }]);
  });

  it("leaves a file the agent can still read, referencing both secrets", () => {
    const { content } = save(FILE, bearer);
    const names = referencedSecretNames(content);
    expect(names).toContain("ANTHROPIC_API_KEY");
    expect(names).toContain("HUGGINGFACE_TOKEN");
  });

  it("keeps a non-credential field readable in the file", () => {
    const { content, stored } = save(FILE, {
      name: "acme",
      url: "https://acme/mcp",
      type: "basic",
      fields: { username: "alice", password: "hunter2" },
    });
    expect(content).toContain("alice");
    expect(content).not.toContain("hunter2");
    expect(stored).toEqual([{ name: "ACME_PASSWORD", value: "hunter2" }]);
  });

  it("does not collide with a name the file already uses", () => {
    const withToken = save(FILE, bearer).content;
    const { content, stored } = save(withToken, {
      ...bearer,
      name: "huggingface",
      url: "https://other/mcp",
    });
    expect(stored[0]?.name).toBe("HUGGINGFACE_TOKEN_2");
    expect(content).toContain("${env:HUGGINGFACE_TOKEN_2}");
  });
});

describe("re-saving a server that was already captured", () => {
  it("reuses the same name rather than inventing a second one", () => {
    const first = save(FILE, {
      name: "huggingface",
      url: "https://hf.co/mcp",
      type: "bearer",
      fields: { token: "hf_original" },
    });
    const again = save(
      first.content,
      { name: "huggingface", url: "https://hf.co/mcp", type: "bearer", fields: { token: "${env:HUGGINGFACE_TOKEN}" } },
      "huggingface",
    );
    expect(again.content).toContain("${env:HUGGINGFACE_TOKEN}");
    expect(again.content).not.toContain("HUGGINGFACE_TOKEN_2");
    expect(again.stored).toEqual([]);
  });

  it("files a replacement under the same name, not a new one", () => {
    const first = save(FILE, {
      name: "huggingface",
      url: "https://hf.co/mcp",
      type: "bearer",
      fields: { token: "hf_original" },
    });
    const replaced = save(
      first.content,
      { name: "huggingface", url: "https://hf.co/mcp", type: "bearer", fields: { token: "hf_replacement" } },
      "huggingface",
    );
    expect(replaced.stored).toEqual([{ name: "HUGGINGFACE_TOKEN", value: "hf_replacement" }]);
    expect(replaced.content).not.toContain("hf_replacement");
  });
});

describe("a file that still holds a raw credential", () => {
  it("moves it out of the file on the next save", () => {
    const legacy = addMcpServer(FILE, {
      name: "legacy",
      url: "https://legacy/mcp",
      auth: { type: "bearer", fields: { token: "raw_left_in_the_file" } },
    });
    expect(legacy).toContain("raw_left_in_the_file");

    const { content, stored } = save(
      legacy,
      { name: "legacy", url: "https://legacy/mcp", type: "bearer", fields: { token: "raw_left_in_the_file" } },
      "legacy",
    );
    expect(content).not.toContain("raw_left_in_the_file");
    expect(stored).toEqual([{ name: "LEGACY_TOKEN", value: "raw_left_in_the_file" }]);
  });
});

describe("lacksRequiredField", () => {
  const token = [{ key: "token", required: true }];
  const basic = [
    { key: "username", required: true },
    { key: "password", required: true },
  ];

  it("is true while a required field is not in what would be written", () => {
    expect(lacksRequiredField(token, { type: "bearer", fields: {} })).toBe(true);
  });

  it("is false once the required field is given", () => {
    expect(lacksRequiredField(token, { type: "bearer", fields: { token: "${env:HF_TOKEN}" } })).toBe(false);
  });

  it("wants every required field of a method, not just one", () => {
    expect(lacksRequiredField(basic, { type: "basic", fields: { username: "ada" } })).toBe(true);
    expect(lacksRequiredField(basic, { type: "basic", fields: { username: "ada", password: "${env:P}" } })).toBe(false);
  });

  it("does not ask for an optional field", () => {
    expect(lacksRequiredField([{ key: "header_name", required: false }], { type: "api-key", fields: {} })).toBe(false);
  });

  it("asks for nothing when the server signs in with no method", () => {
    expect(lacksRequiredField([], undefined)).toBe(false);
  });
});
