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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchMcpRegistry, publisherFrom, fetchServerDetail, loadRecentServers, recordRecentServer, resolveMcpServerAuth } from "./mcp-servers";
import type { DirectoryEntry } from "./mcp-servers";

// Real shapes, captured against registry.modelcontextprotocol.io on 2026-09-01.
const LINEAR_ROW = {
  server: {
    name: "app.linear/linear",
    title: "Linear",
    description: "MCP server for Linear project management and issue tracking",
    version: "1.0.1",
    websiteUrl: "https://linear.app",
    remotes: [{ type: "streamable-http", url: "https://mcp.linear.app/mcp" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } },
};
const CONTEXT7_ROW = {
  server: {
    name: "io.github.upstash/context7",
    description: "Up-to-date documentation for any library",
    remotes: [{ type: "streamable-http", url: "https://mcp.context7.com/mcp" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const NEEDS_KEY_ROW = {
  server: {
    name: "com.example/needs-key",
    description: "A server that requires a bearer token",
    remotes: [
      {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
        headers: [{ name: "Authorization", isRequired: true, isSecret: true }],
      },
    ],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const STDIO_ONLY_ROW = {
  server: {
    name: "com.example/local-only",
    description: "npm package, no remote",
    packages: [{ registryType: "npm", identifier: "example" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const SSE_ONLY_ROW = {
  server: {
    name: "com.example/legacy",
    description: "Legacy transport only",
    remotes: [{ type: "sse", url: "https://mcp.example.com/sse" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const TEMPLATED_ROW = {
  server: {
    name: "com.example/templated",
    description: "Needs a variable filled in",
    remotes: [{ type: "streamable-http", url: "https://{region}.example.com/mcp" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
};
const DELETED_ROW = {
  server: {
    name: "com.example/gone",
    description: "Removed by moderation",
    remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted" } },
};

function fakeFetch(status: number, json: unknown) {
  const requested: string[] = [];
  const fn = (async (url: string) => {
    requested.push(String(url));
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, requested };
}

describe("searchMcpRegistry", () => {
  it("maps a real streamable-http entry (Linear) to a directory entry", async () => {
    const { fn } = fakeFetch(200, { servers: [LINEAR_ROW] });
    const result = await searchMcpRegistry("linear", fn);
    expect(result).toEqual({
      ok: true,
      entries: [
        {
          id: "app.linear/linear",
          title: "Linear",
          description: LINEAR_ROW.server.description,
          url: "https://mcp.linear.app/mcp",
          // "app.linear" is reverse-DNS, so it reads back as the domain it was proved against.
          publisher: { kind: "domain", label: "linear.app" },
          needsKey: false,
          version: LINEAR_ROW.server.version,
          websiteUrl: LINEAR_ROW.server.websiteUrl,
          repositoryUrl: undefined,
          updatedAt: undefined,
          status: "active",
          headers: [],
        },
      ],
    });
  });

  it("falls back to the last name segment when the entry has no title", async () => {
    const { fn } = fakeFetch(200, { servers: [CONTEXT7_ROW] });
    const result = await searchMcpRegistry("context7", fn);
    expect(result.ok).toBe(true);
    expect(result.ok && result.entries[0]?.title).toBe("context7");
    expect(result.ok && result.entries[0]?.publisher).toEqual({ kind: "github", label: "github.com/upstash" });
  });

  it("flags needsKey when the remote declares a required header", async () => {
    const { fn } = fakeFetch(200, { servers: [NEEDS_KEY_ROW] });
    const result = await searchMcpRegistry("needs-key", fn);
    expect(result.ok && result.entries[0]?.needsKey).toBe(true);
  });

  it("excludes package-only servers - nothing here can spawn a local process", async () => {
    const { fn } = fakeFetch(200, { servers: [STDIO_ONLY_ROW] });
    expect(await searchMcpRegistry("local", fn)).toEqual({ ok: true, entries: [] });
  });

  it("excludes sse-only servers - the adapter speaks Streamable HTTP only", async () => {
    const { fn } = fakeFetch(200, { servers: [SSE_ONLY_ROW] });
    expect(await searchMcpRegistry("legacy", fn)).toEqual({ ok: true, entries: [] });
  });

  it("excludes a URL with an unfilled {template} variable", async () => {
    const { fn } = fakeFetch(200, { servers: [TEMPLATED_ROW] });
    expect(await searchMcpRegistry("templated", fn)).toEqual({ ok: true, entries: [] });
  });

  it("excludes a deleted entry", async () => {
    const { fn } = fakeFetch(200, { servers: [DELETED_ROW] });
    expect(await searchMcpRegistry("gone", fn)).toEqual({ ok: true, entries: [] });
  });

  it("keeps only the usable entries out of a mixed page", async () => {
    const { fn } = fakeFetch(200, { servers: [LINEAR_ROW, STDIO_ONLY_ROW, SSE_ONLY_ROW, CONTEXT7_ROW] });
    const result = await searchMcpRegistry("x", fn);
    expect(result.ok && result.entries.map((entry) => entry.id)).toEqual(["app.linear/linear", "io.github.upstash/context7"]);
  });

  it("sends the search term as a query param, and omits it when blank", async () => {
    const { fn, requested } = fakeFetch(200, { servers: [] });
    await searchMcpRegistry("docs", fn);
    expect(new URL(requested[0] ?? "").searchParams.get("search")).toBe("docs");

    await searchMcpRegistry("  ", fn);
    expect(new URL(requested[1] ?? "").searchParams.has("search")).toBe(false);
  });

  it("reports ok:false rather than throwing when the registry is unreachable", async () => {
    const fn = (async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    expect(await searchMcpRegistry("x", fn)).toEqual({ ok: false });
  });

  it("reports ok:false on a non-OK response - distinct from a real empty result", async () => {
    const { fn } = fakeFetch(500, {});
    expect(await searchMcpRegistry("x", fn)).toEqual({ ok: false });
  });
});

describe("publisherFrom", () => {
  // Reverse-DNS: the namespace reads back as the domain the registry checked it against.
  it("reads a domain namespace back into its hostname", () => {
    expect(publisherFrom("com.notion/mcp")).toEqual({ kind: "domain", label: "notion.com" });
    expect(publisherFrom("app.linear/linear")).toEqual({ kind: "domain", label: "linear.app" });
    expect(publisherFrom("ai.smithery/smithery-notion")).toEqual({ kind: "domain", label: "smithery.ai" });
  });

  it("names the account for a GitHub namespace, which is a person rather than a brand", () => {
    expect(publisherFrom("io.github.sadri-dridi/notion-url-shape")).toEqual({
      kind: "github",
      label: "github.com/sadri-dridi",
    });
  });

  // The distinction the badge draws: a third party relaying to Notion publishes under its OWN
  // domain, so printing the domain is what gives it away.
  it("does not let a third party borrow the brand it relays to", () => {
    expect(publisherFrom("ai.smithery/smithery-notion").label).not.toContain("notion");
  });
});

// Rows kept in "recently connected" were written by whatever version was current then, so an old
// one can be missing fields added since. The detail panel re-reads the registry to fill them in.
describe("fetchServerDetail", () => {
  it("returns the entry whose id matches exactly", async () => {
    const { fn } = fakeFetch(200, { servers: [CONTEXT7_ROW, LINEAR_ROW] });
    const found = await fetchServerDetail("app.linear/linear", fn);
    expect(found?.id).toBe("app.linear/linear");
    expect(found?.version).toBe(LINEAR_ROW.server.version);
  });

  it("returns null when the search hits nothing with that exact id", async () => {
    const { fn } = fakeFetch(200, { servers: [CONTEXT7_ROW] });
    expect(await fetchServerDetail("app.linear/linear", fn)).toBeNull();
  });

  it("returns null rather than throwing when the registry is unreachable", async () => {
    const fn = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await fetchServerDetail("app.linear/linear", fn)).toBeNull();
  });
});

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function entry(id: string): DirectoryEntry {
  return {
    id,
    title: id,
    description: `the ${id} server`,
    url: `https://${id}.example.com/mcp`,
    publisher: publisherFrom(id),
    needsKey: false,
    headers: [],
  };
}

describe("recently connected MCP servers", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has nothing to show before anything has been connected", () => {
    expect(loadRecentServers()).toEqual([]);
  });

  it("remembers a server that was connected", () => {
    recordRecentServer(entry("linear"));
    expect(loadRecentServers()).toEqual([entry("linear")]);
  });

  it("puts the one just connected first", () => {
    recordRecentServer(entry("linear"));
    recordRecentServer(entry("huggingface"));
    expect(loadRecentServers().map((e) => e.id)).toEqual(["huggingface", "linear"]);
  });

  it("moves a server already in the list back to the front instead of duplicating it", () => {
    recordRecentServer(entry("linear"));
    recordRecentServer(entry("huggingface"));
    recordRecentServer(entry("linear"));
    expect(loadRecentServers().map((e) => e.id)).toEqual(["linear", "huggingface"]);
  });

  it("keeps only the most recent few", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) recordRecentServer(entry(id));
    expect(loadRecentServers().map((e) => e.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => recordRecentServer(entry("linear"))).not.toThrow();
    expect(loadRecentServers()).toEqual([]);
  });
});

// Rows written before publisher became an object are still in real browsers. Reading them must
// repair them, not hand the UI a string where it expects { kind, label } - or a missing headers
// array it is about to call .find on.
describe("rows stored by an older version", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
  });

  it("rebuilds the publisher and headers from what was saved", () => {
    localStorage.setItem(
      "afm.mcp-recent.v1",
      JSON.stringify([
        {
          id: "com.notion/mcp",
          title: "Notion",
          description: "old row",
          url: "https://mcp.notion.com/mcp",
          publisher: "notion",
          needsKey: false,
        },
      ]),
    );
    const [entry] = loadRecentServers();
    expect(entry?.publisher).toEqual({ kind: "domain", label: "notion.com" });
    expect(entry?.headers).toEqual([]);
  });
});

const REDIRECT_URI = "http://localhost:5173/";
const CIMD_CLIENT_ID = "https://afm.example.com/oauth/client-metadata.json";

// Real traces, captured against mcp.linear.app on 2026-09-01.
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

describe("resolveMcpServerAuth", () => {
  it("returns null for a server that needs no auth", async () => {
    const { fn } = routedFetch({ "https://mcp.example.com/mcp": { status: 200, json: {} } });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toBeNull();
  });

  it("resolves Linear end to end via CIMD - no registration call, since Linear advertises support for it", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 200, json: LINEAR_AS_METADATA },
    });
    const result = await resolveMcpServerAuth("https://mcp.linear.app/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toEqual({
      authorizeUrl: "https://mcp.linear.app/authorize",
      tokenUrl: "https://mcp.linear.app/token",
      clientId: CIMD_CLIENT_ID,
      // Linear's real 401 sends no scope hint of its own, so this falls back to the PRM's
      // scopes_supported - covered on its own in the next test.
      scopes: ["read", "write"],
    });
    expect(requested).not.toContain("https://mcp.linear.app/register");
  });

  it("carries the PRM's scopes_supported through when the 401 gave no scope hint of its own", async () => {
    const { fn } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 200, json: LINEAR_AS_METADATA },
    });
    const result = await resolveMcpServerAuth("https://mcp.linear.app/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result?.scopes).toEqual(["read", "write"]);
  });

  it("registers a client instead when no client id document is configured, even if the AS supports one", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 200, json: LINEAR_AS_METADATA },
      "https://mcp.linear.app/register": { status: 201, json: { client_id: "dcr-linear" } },
    });
    const result = await resolveMcpServerAuth("https://mcp.linear.app/mcp", fn, undefined, REDIRECT_URI);
    expect(result?.clientId).toBe("dcr-linear");
    expect(requested).toContain("https://mcp.linear.app/register");
  });

  it("leaves the client id empty when no document is configured and registration fails", async () => {
    const { fn } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
      "https://mcp.linear.app/.well-known/oauth-authorization-server": { status: 200, json: LINEAR_AS_METADATA },
    });
    const result = await resolveMcpServerAuth("https://mcp.linear.app/mcp", fn, undefined, REDIRECT_URI);
    expect(result?.clientId).toBe("");
  });

  it.each([
    ["does not list PKCE methods", undefined],
    ["lists only plain", ["plain"]],
  ])("returns null when the authorization server %s", async (_label, methods) => {
    const { fn } = routedFetch({
      "https://mcp.linear.app/mcp": { status: 401, headers: { "www-authenticate": LINEAR_CHALLENGE } },
      "https://mcp.linear.app/.well-known/oauth-protected-resource/mcp": { status: 200, json: LINEAR_PRM },
      "https://mcp.linear.app/.well-known/oauth-authorization-server": {
        status: 200,
        json: { ...LINEAR_AS_METADATA, code_challenge_methods_supported: methods },
      },
    });
    expect(await resolveMcpServerAuth("https://mcp.linear.app/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI)).toBeNull();
  });

  it("registers a client via DCR when the AS has a registration_endpoint but no CIMD support", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/prm"' },
      },
      "https://mcp.example.com/prm": {
        status: 200,
        json: { resource: "https://mcp.example.com/mcp", authorization_servers: ["https://as.example.com"] },
      },
      "https://as.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        json: {
          issuer: "https://as.example.com",
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
          code_challenge_methods_supported: ["S256"],
          registration_endpoint: "https://as.example.com/register",
        },
      },
      "https://as.example.com/register": { status: 201, json: { client_id: "dcr-client-id" } },
    });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result?.clientId).toBe("dcr-client-id");
    expect(requested).toContain("https://as.example.com/register");
  });

  it("still returns the resolved endpoints, with an empty client_id, when neither CIMD nor DCR is available", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/prm"' },
      },
      "https://mcp.example.com/prm": {
        status: 200,
        json: { resource: "https://mcp.example.com/mcp", authorization_servers: ["https://as.example.com"] },
      },
      "https://as.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        json: {
          issuer: "https://as.example.com",
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
          code_challenge_methods_supported: ["S256"],
        },
      },
    });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toEqual({
      authorizeUrl: "https://as.example.com/authorize",
      tokenUrl: "https://as.example.com/token",
      clientId: "",
      scopes: undefined,
    });
  });

  it("still returns an empty client_id, rather than throwing, when the DCR call itself fails", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/prm"' },
      },
      "https://mcp.example.com/prm": {
        status: 200,
        json: { resource: "https://mcp.example.com/mcp", authorization_servers: ["https://as.example.com"] },
      },
      "https://as.example.com/.well-known/oauth-authorization-server": {
        status: 200,
        json: {
          issuer: "https://as.example.com",
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
          code_challenge_methods_supported: ["S256"],
          registration_endpoint: "https://as.example.com/register",
        },
      },
      "https://as.example.com/register": { status: 400, json: { error: "invalid_client_metadata" } },
    });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result?.clientId).toBe("");
  });

  // Real trace, captured against mcp.atlassian.com on 2026-09-01: its 401 carries a
  // WWW-Authenticate challenge with no resource_metadata param at all, and it serves no
  // Protected Resource Metadata document at either well-known candidate - but it acts as its
  // own authorization server, publishing valid RFC 8414 metadata at its own root well-known.
  it("falls back to the server's own origin as its authorization server when it publishes no PRM at all - Atlassian's real shape", async () => {
    const { fn, requested } = routedFetch({
      "https://mcp.atlassian.com/v1/mcp": {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
        },
      },
      "https://mcp.atlassian.com/.well-known/oauth-authorization-server": {
        status: 200,
        json: {
          issuer: "https://mcp.atlassian.com",
          authorization_endpoint: "https://mcp.atlassian.com/v1/authorize",
          token_endpoint: "https://mcp.atlassian.com/v1/token",
          code_challenge_methods_supported: ["S256"],
          registration_endpoint: "https://mcp.atlassian.com/v1/register",
        },
      },
      "https://mcp.atlassian.com/v1/register": { status: 201, json: { client_id: "atlassian-dcr-client" } },
    });
    const result = await resolveMcpServerAuth("https://mcp.atlassian.com/v1/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toEqual({
      authorizeUrl: "https://mcp.atlassian.com/v1/authorize",
      tokenUrl: "https://mcp.atlassian.com/v1/token",
      clientId: "atlassian-dcr-client",
      scopes: undefined,
    });
    // Never guesses a path-suffixed well-known on the resource's own origin for this fallback -
    // that already 404s for Atlassian (checked live) and only the bare-root document is real.
    expect(requested).toContain("https://mcp.atlassian.com/.well-known/oauth-authorization-server");
  });

  it("still returns null for a server with no PRM and no authorization server of its own", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": { status: 401 },
    });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toBeNull();
  });

  it("returns null when the resource server's authorization server can't be resolved at all", async () => {
    const { fn } = routedFetch({
      "https://mcp.example.com/mcp": {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/prm"' },
      },
      "https://mcp.example.com/prm": {
        status: 200,
        json: { resource: "https://mcp.example.com/mcp", authorization_servers: ["https://as.example.com"] },
      },
    });
    const result = await resolveMcpServerAuth("https://mcp.example.com/mcp", fn, CIMD_CLIENT_ID, REDIRECT_URI);
    expect(result).toBeNull();
  });
});
