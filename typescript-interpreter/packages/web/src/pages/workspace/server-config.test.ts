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
import { buildableAgent } from "../../agent-validation";
import { addMcpServer } from "./agent-source-edit";
import { lacksRequiredField } from "./mcp-secret-fields";
import { AUTH_METHODS, nameFromUrl, prepareServerSave } from "./server-config";

const FILE = `---
name: Fixture
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:MODEL_KEY}
---

# Role
Keep this role exactly.

# Instructions
- Keep **formatting** and comments.
`;

const server = { name: "acme", url: "https://acme.example/mcp" };
type Save = Parameters<typeof prepareServerSave>[0];

function save(overrides: Partial<Save> = {}) {
  return prepareServerSave({ content: FILE, editing: null, server, knownSecrets: [], tools: null, allowed: [], ...overrides });
}

function configured(content: string) {
  const parsed = buildableAgent(content);
  if (!parsed.ok) throw new Error("Invalid fixture result");
  return parsed.metadata.tools?.mcp?.find((item) => item.name === "acme");
}

describe("server authentication fields", () => {
  it("keeps the supported methods, field order and required rules explicit", () => {
    expect(AUTH_METHODS.map((method) => [method.id, method.fields.map((field) => [field.key, field.required])])).toEqual([
      ["none", []],
      ["bearer", [["token", true]]],
      ["basic", [["username", true], ["password", true]]],
      ["api-key", [["api_key", true], ["header_name", false]]],
      ["oauth2", [["authorize_url", true], ["token_url", true], ["client_id", true], ["scopes", false]]],
    ]);
  });

  it.each(AUTH_METHODS)("requires every required field of $id and no optional ones", (method) => {
    const fields = Object.fromEntries(method.fields.filter((field) => field.required).map((field) => [field.key, "fixture"]));
    expect(lacksRequiredField(method.fields, { type: method.id, fields })).toBe(false);
    for (const field of method.fields.filter((field) => field.required)) {
      const partial = { ...fields };
      delete partial[field.key];
      expect(lacksRequiredField(method.fields, { type: method.id, fields: partial })).toBe(true);
    }
  });
});

describe("nameFromUrl", () => {
  it.each([
    ["not a URL", [], ""],
    ["https://mcp.api.www.Acme.example/mcp", [], "acme"],
    ["https://acme.example/mcp", ["acme", "acme-2"], "acme-3"],
    ["https://localhost:8080/mcp", [], "localhost"],
    ["https://www.mcp.api/mcp", [], "wwwmcpapi"],
  ] as [string, string[], string][])("names %s without changing the URL rule", (url, taken, expected) => {
    expect(nameFromUrl(url, taken)).toBe(expected);
  });
});

describe("prepareServerSave", () => {
  it("leaves an unlisted server unrestricted and preserves the body byte for byte", () => {
    const result = save();
    expect(configured(result.content)?.tool_filter).toBeUndefined();
    expect(configured(result.content)?.transport).toEqual({ type: "http", url: server.url });
    expect(result.content.split("---").slice(2).join("---")).toBe(FILE.split("---").slice(2).join("---"));
    expect(result.secrets).toEqual([]);
  });

  it("distinguishes an explicit empty tool list from an unlisted one", () => {
    expect(configured(save({ tools: [] }).content)?.tool_filter).toEqual({ allow: [] });
  });

  it("writes allow and deny lists in discovered order, ignoring selections not in the list", () => {
    const result = save({ tools: [{ name: "search" }, { name: "delete" }, { name: "read" }], allowed: ["read", "absent", "search"] });
    expect(configured(result.content)?.tool_filter).toEqual({ allow: ["search", "read"], deny: ["delete"] });
  });

  it("avoids both referenced and device-held credential names", () => {
    const result = save({
      content: FILE.replace("MODEL_KEY", "ACME_TOKEN"),
      server: { ...server, auth: { type: "bearer", fields: { token: "fake-local-token" } } },
      knownSecrets: ["ACME_TOKEN_2"],
    });
    expect(result.secrets).toEqual([{ name: "ACME_TOKEN_3", value: "fake-local-token" }]);
    expect(result.content).toContain("${env:ACME_TOKEN_3}");
    expect(result.content).not.toContain("fake-local-token");
  });

  it("reuses a removed block's name unless that name is still held on the device", () => {
    const content = addMcpServer(FILE, { ...server, auth: { type: "bearer", fields: { token: "${env:ACME_TOKEN}" } } });
    const replacement = { ...server, auth: { type: "bearer", fields: { token: "replacement" } } };
    expect(save({ content, editing: "acme", server: replacement }).secrets[0]?.name).toBe("ACME_TOKEN");
    expect(save({ content, editing: "acme", server: replacement, knownSecrets: ["ACME_TOKEN"] }).secrets[0]?.name).toBe("ACME_TOKEN_2");
  });

  it("keeps existing references and OAuth configuration out of the capture list", () => {
    const auth = { type: "oauth2", fields: { authorize_url: "https://acme.example/auth", token_url: "https://acme.example/token", client_id: "public", grant_type: "authorization_code" }, scopes: ["read", "write"] };
    const result = save({ server: { ...server, auth } });
    expect(result.secrets).toEqual([]);
    expect(configured(result.content)?.transport).toMatchObject({ authentication: { type: auth.type, ...auth.fields, scopes: auth.scopes } });
    expect(save({ server: { ...server, auth: { type: "bearer", fields: { token: "${env:EXISTING}" } } } }).secrets).toEqual([]);
  });

  it("does not mutate the supplied server, tools, allowed names, or known credentials", () => {
    const input: Save = { content: FILE, editing: null, server: { ...server, auth: { type: "basic", fields: { username: "alice", password: "fake-password" } } }, tools: [{ name: "read" }], allowed: ["read"], knownSecrets: [] };
    const before = structuredClone(input);
    Object.freeze(input.server.auth!.fields);
    Object.freeze(input.server.auth);
    Object.freeze(input.server);
    Object.freeze(input.tools);
    Object.freeze(input.allowed);
    Object.freeze(input.knownSecrets);
    prepareServerSave(input);
    expect(input).toEqual(before);
  });
});
