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

import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AgentMetadata } from "@afm/engine";
import { toolsFromMetadata, defaultMcpProxyConfig, McpProxyRequiredError, createProxiedFetch } from "./tool-factory";

function start401Server(): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer: Server = createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_token", error_description: "Token was revoked." }));
  });
  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((res) => httpServer.close(() => res())),
      });
    });
  });
}

function metadataWithMcp(mcp: NonNullable<AgentMetadata["tools"]>["mcp"]): AgentMetadata {
  return { tools: { mcp } } as unknown as AgentMetadata;
}

const httpServer = (name: string) => ({
  name,
  transport: { type: "http" as const, url: `https://${name}.example.com/mcp` },
});

describe("toolsFromMetadata - the browser's mandatory-proxy policy", () => {
  it("throws McpProxyRequiredError when the agent uses MCP servers but no proxy is configured (no build default, no override)", () => {
    expect(() => toolsFromMetadata(metadataWithMcp([httpServer("a")]), null)).toThrow(
      McpProxyRequiredError,
    );
  });

  it("does NOT throw when the agent declares no MCP servers at all, even with no proxy", () => {
    expect(() => toolsFromMetadata(metadataWithMcp([]), null)).not.toThrow();
    expect(() => toolsFromMetadata(metadataWithMcp(undefined), null)).not.toThrow();
  });

  it("does not throw when a runtime proxy override is provided", () => {
    expect(() =>
      toolsFromMetadata(metadataWithMcp([httpServer("a")]), { url: "https://proxy.local/mcp" }),
    ).not.toThrow();
  });

  it("never silently falls back to a direct connection - omitting the override still requires a proxy to exist somewhere", () => {
    expect(() => toolsFromMetadata(metadataWithMcp([httpServer("a")]), defaultMcpProxyConfig)).toThrow(
      McpProxyRequiredError,
    );
  });
});

describe("toolsFromMetadata - oauth2 auth routing", () => {
  const withAuth = (authentication: unknown) =>
    metadataWithMcp([{ ...httpServer("a"), transport: { ...httpServer("a").transport, authentication } }] as never);

  it("builds a tool port for an oauth2 client_credentials server without throwing", () => {
    expect(() =>
      toolsFromMetadata(
        withAuth({ type: "oauth2", grant_type: "client_credentials", token_url: "https://t", client_id: "i", client_secret: "s" }),
        { url: "https://proxy.local/mcp" },
      ),
    ).not.toThrow();
  });

  it("does not build a tool port for a jwt block - a browser does not sign tokens", () => {
    expect(() =>
      toolsFromMetadata(withAuth({ type: "jwt", issuer: "i", signing_key: "s" }), { url: "https://proxy.local/mcp" }),
    ).toThrow(/Unsupported authentication type: 'jwt'/);
  });

  it("throws a clear error for oauth2 authorization_code when no interactive-token dependency was supplied", () => {
    expect(() =>
      toolsFromMetadata(
        withAuth({ type: "oauth2", grant_type: "authorization_code", authorize_url: "https://a", token_url: "https://t", client_id: "c" }),
        { url: "https://proxy.local/mcp" },
      ),
    ).toThrow(/interactive sign-in/);
  });

  it("uses the supplied getInteractiveToken dependency for authorization_code", () => {
    expect(() =>
      toolsFromMetadata(
        withAuth({ type: "oauth2", grant_type: "authorization_code", authorize_url: "https://a", token_url: "https://t", client_id: "c" }),
        { url: "https://proxy.local/mcp" },
        { getInteractiveToken: async () => "tok" },
      ),
    ).not.toThrow();
  });
});

describe("toolsFromMetadata - recovering from a revoked authorization_code token", () => {
  let server: { url: string; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("reports the rejected provider (authorize_url/token_url/client_id/resource) when the resource server returns 401 for a authorization_code-authenticated server, so the caller can invalidate exactly that cached session", async () => {
    server = await start401Server();
    const metadata = metadataWithMcp([
      {
        ...httpServer("a"),
        transport: {
          ...httpServer("a").transport,
          authentication: {
            type: "oauth2",
            grant_type: "authorization_code",
            authorize_url: "https://gitlab.example.com/oauth/authorize",
            token_url: "https://gitlab.example.com/oauth/token",
            client_id: "gitlab-client",
          },
        },
      } as never,
    ]);

    const rejections: { authorizeUrl: string; tokenUrl: string; clientId: string; resource?: string }[] = [];
    const tools = toolsFromMetadata(metadata, { url: server.url }, {
      getInteractiveToken: async () => "revoked-token",
      onInteractiveAuthRejected: (provider) => rejections.push(provider),
    });

    await expect(tools.list()).rejects.toBeTruthy();
    expect(rejections).toEqual([
      {
        authorizeUrl: "https://gitlab.example.com/oauth/authorize",
        tokenUrl: "https://gitlab.example.com/oauth/token",
        clientId: "gitlab-client",
        // The MCP server's own URL (RFC 8707) - so invalidating this session can never collide
        // with a different server that happens to share the same authorize_url/client_id.
        resource: "https://a.example.com/mcp",
      },
    ]);
  });

  it("does NOT call onInteractiveAuthRejected for non-interactive (client_credentials) oauth2 servers", async () => {
    server = await start401Server();
    const metadata = metadataWithMcp([
      {
        ...httpServer("a"),
        transport: {
          ...httpServer("a").transport,
          authentication: { type: "oauth2", grant_type: "client_credentials", token_url: "https://t", client_id: "i", client_secret: "s" },
        },
      } as never,
    ]);

    let rejectedCount = 0;
    const tools = toolsFromMetadata(metadata, { url: server.url }, { onInteractiveAuthRejected: () => (rejectedCount += 1) });

    await expect(tools.list()).rejects.toBeTruthy();
    expect(rejectedCount).toBe(0);
  });
});

describe("createProxiedFetch", () => {
  it("rewrites the URL to go through the proxy with ?target=<encoded original url>", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    }) as unknown as typeof fetch;

    try {
      const proxiedFetch = createProxiedFetch({ url: "http://localhost:8787/" });
      await proxiedFetch("https://auth.example.com/oauth2/token", { method: "POST" });

      expect(calls[0]?.url).toBe(`http://localhost:8787/?target=${encodeURIComponent("https://auth.example.com/oauth2/token")}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps a query the proxy address already carries instead of adding a second '?'", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response("{}");
    }) as unknown as typeof fetch;

    try {
      await createProxiedFetch({ url: "https://proxy.example.com/mcp?v=2" })("https://auth.example.com/token");
      const url = new URL(calls[0]!);
      expect(url.searchParams.get("v")).toBe("2");
      expect(url.searchParams.get("target")).toBe("https://auth.example.com/token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
