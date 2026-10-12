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
import {
  parseResourceMetadataUrl,
  parseChallengeScope,
  discoverProtectedResource,
  discoverAuthorizationServer,
  registerClient,
} from "./discovery";

const LINEAR_CHALLENGE =
  'Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Missing or invalid access token"';
const LINEAR_PRM = {
  resource: "https://mcp.linear.app/mcp",
  authorization_servers: ["https://mcp.linear.app"],
  scopes_supported: ["read", "write"],
  bearer_methods_supported: ["header"],
};
const LINEAR_AS_METADATA = {
  issuer: "https://mcp.linear.app",
  authorization_endpoint: "https://mcp.linear.app/authorize",
  token_endpoint: "https://mcp.linear.app/token",
  code_challenge_methods_supported: ["S256"],
  registration_endpoint: "https://mcp.linear.app/register",
  client_id_metadata_document_supported: true,
};

describe("parseResourceMetadataUrl", () => {
  it("reads resource_metadata out of a real WWW-Authenticate challenge", () => {
    expect(parseResourceMetadataUrl(LINEAR_CHALLENGE)).toBe(
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("is null when the header has no resource_metadata param", () => {
    expect(parseResourceMetadataUrl('Bearer realm="OAuth"')).toBeNull();
  });
});

describe("parseChallengeScope", () => {
  it("reads a scope hint when the server sends one", () => {
    expect(parseChallengeScope('Bearer resource_metadata="https://x/y", scope="files:read files:write"')).toEqual([
      "files:read",
      "files:write",
    ]);
  });

  it("is null when there is no scope param - Linear's real challenge, for one, sends none", () => {
    expect(parseChallengeScope(LINEAR_CHALLENGE)).toBeNull();
  });
});

function routedFetch(routes: Record<string, { status: number; headers?: Record<string, string>; json?: unknown }>) {
  const requested: string[] = [];
  const fn = (async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (route === undefined) {
      return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      headers: new Headers(route.headers ?? {}),
      json: async () => route.json,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, requested };
}

describe("discoverProtectedResource", () => {
  it("returns null when the server answers without a 401 - no auth needed", async () => {
    const { fn } = routedFetch({ "https://mcp.example.com/mcp": { status: 200, json: {} } });
    expect(await discoverProtectedResource("https://mcp.example.com/mcp", fn)).toBeNull();
  });

  it("returns null when the probe fails outright (network/CORS) rather than throwing", async () => {
    const fn = (async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    expect(await discoverProtectedResource("https://mcp.example.com/mcp", fn)).toBeNull();
  });

  it("on a 401 with resource_metadata in WWW-Authenticate, fetches exactly that URL - Linear's real shape", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
    });
    const result = await discoverProtectedResource("https://mcp.linear.app/mcp", fn);
    expect(result?.metadata).toEqual(LINEAR_PRM);
    expect(result?.challengeScope).toBeNull();
    expect(requested).toEqual([
      "https://mcp.linear.app/mcp",
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp",
    ]);
  });

  it("carries the challenge's scope hint through when the server sends one", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      },
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
    });
    const result = await discoverProtectedResource("https://mcp.example.com/mcp", fn);
    expect(result?.challengeScope).toEqual(["files:read"]);
  });

  it("falls back to the well-known paths, server path then root, when the 401 has no header at all", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.example.com/mcp": { status: 401 },
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": { status: 404 },
      "https://mcp.example.com/.well-known/oauth-protected-resource": { status: 200, json: LINEAR_PRM },
    });
    const result = await discoverProtectedResource("https://mcp.example.com/mcp", fn);
    expect(result?.metadata).toEqual(LINEAR_PRM);
    expect(requested).toEqual([
      "https://mcp.example.com/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
  });

  it("returns null when every candidate comes back empty", async () => {
    const { fn } = routedFetch({ "https://mcp.example.com/mcp": { status: 401 } });
    expect(await discoverProtectedResource("https://mcp.example.com/mcp", fn)).toBeNull();
  });

  it("rejects a metadata document with no authorization_servers", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/prm"' },
      },
      "https://mcp.example.com/prm": { status: 200, json: { resource: "https://mcp.example.com/mcp" } },
    });
    expect(await discoverProtectedResource("https://mcp.example.com/mcp", fn)).toBeNull();
  });
});

describe("discoverAuthorizationServer", () => {
  it("resolves Linear's real issuer via the OAuth well-known path", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 200, json: LINEAR_AS_METADATA },
    });
    const result = await discoverAuthorizationServer("https://mcp.linear.app", fn);
    expect(result).toEqual(LINEAR_AS_METADATA);
    expect(requested).toEqual(["https://mcp.linear.app/.well-known/oauth-authorization-server"]);
  });

  it("falls back to OpenID Connect discovery when the OAuth path 404s", async () => {
    const oidc = { ...LINEAR_AS_METADATA, registration_endpoint: undefined };
    const { fn } = routedFetch({
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 404 },
      "https://mcp.linear.app/.well-known/openid-configuration": { status: 200, json: oidc },
    });
    expect(await discoverAuthorizationServer("https://mcp.linear.app", fn)).toEqual(oidc);
  });

  it("rejects a document whose issuer does not match, and moves on to the next candidate", async () => {
    const { fn } = routedFetch({
      "https://mcp.linear.app/.well-known/oauth-authorization-server": {
        status: 200,
        json: { ...LINEAR_AS_METADATA, issuer: "https://attacker.example" },
      },
      "https://mcp.linear.app/.well-known/openid-configuration": { status: 200, json: LINEAR_AS_METADATA },
    });
    expect(await discoverAuthorizationServer("https://mcp.linear.app", fn)).toEqual(LINEAR_AS_METADATA);
  });

  it.each([
    ["does not list PKCE methods", undefined],
    ["lists only plain", ["plain"]],
  ])("rejects a document that %s", async (_label, methods) => {
    const { fn } = routedFetch({
      "https://mcp.linear.app/.well-known/oauth-authorization-server": {
        status: 200,
        json: { ...LINEAR_AS_METADATA, code_challenge_methods_supported: methods },
      },
    });
    expect(await discoverAuthorizationServer("https://mcp.linear.app", fn)).toBeNull();
  });

  it("tries all three candidates, in order, for an issuer with a path component", async () => {
    const { fn, requested } = routedFetch({});
    await discoverAuthorizationServer("https://auth.example.com/tenant1", fn);
    expect(requested).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
  });

  it("returns null when nothing answers", async () => {
    const { fn } = routedFetch({});
    expect(await discoverAuthorizationServer("https://mcp.example.com", fn)).toBeNull();
  });
});

function fakeFetch(status: number, json: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("registerClient", () => {
  it("POSTs a public-client registration and returns the client_id", async () => {
    const { fn, calls } = fakeFetch(201, { client_id: "dcr-generated-id" });
    const result = await registerClient("https://mcp.linear.app/register", ["https://afm.example.com/"], fn);
    expect(result).toEqual({ clientId: "dcr-generated-id" });
    expect(calls[0]?.url).toBe("https://mcp.linear.app/register");
    expect(calls[0]?.body).toMatchObject({
      redirect_uris: ["https://afm.example.com/"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    });
    expect(calls[0]?.body.client_secret).toBeUndefined();
  });

  it("declares application_type 'native' for a localhost redirect URI, per the spec's own split", async () => {
    const { fn, calls } = fakeFetch(201, { client_id: "id" });
    await registerClient("https://mcp.example.com/register", ["http://localhost:5173/"], fn);
    expect(calls[0]?.body.application_type).toBe("native");
  });

  it("declares application_type 'web' for a deployed redirect URI", async () => {
    const { fn, calls } = fakeFetch(201, { client_id: "id" });
    await registerClient("https://mcp.example.com/register", ["https://afm.example.com/"], fn);
    expect(calls[0]?.body.application_type).toBe("web");
  });

  it("throws on a non-OK response", async () => {
    const { fn } = fakeFetch(400, { error: "invalid_client_metadata" });
    await expect(registerClient("https://mcp.example.com/register", ["https://afm.example.com/"], fn)).rejects.toThrow(
      /Registration failed: 400/,
    );
  });

  it("throws when the response has no client_id", async () => {
    const { fn } = fakeFetch(201, {});
    await expect(registerClient("https://mcp.example.com/register", ["https://afm.example.com/"], fn)).rejects.toThrow(
      /no client_id/,
    );
  });
});
