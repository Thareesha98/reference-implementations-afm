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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AgentMetadata } from "@afm/engine";
import { toolsFromMetadata, defaultMcpProxyConfig, McpProxyRequiredError, createProxiedFetch, agentFileFetch } from "./tool-factory";

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

describe("the names the model is offered", () => {
  function startToolServer(tools: string[]): Promise<{ url: string; close: () => Promise<void> }> {
    const httpServer: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const message = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { id?: number; method?: string; params?: { protocolVersion?: string; name?: string } };
      const reply = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      if (String(message.method).startsWith("notifications/")) {
        res.writeHead(202);
        return res.end();
      }
      if (message.method === "initialize") return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "t", version: "0" } });
      if (message.method === "tools/list") return reply({ tools: tools.map((name) => ({ name, description: "", inputSchema: { type: "object", properties: {} } })) });
      if (message.method === "tools/call") return reply({ content: [{ type: "text", text: `ran ${message.params?.name}` }] });
      res.writeHead(400);
      res.end();
    });
    return new Promise((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        const { port } = httpServer.address() as { port: number };
        resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((done) => httpServer.close(() => done())) });
      });
    });
  }

  const server = (name: string, allow?: string[]) => ({
    name,
    transport: { type: "http", url: `https://${name}.example.com/mcp` },
    ...(allow === undefined ? {} : { tool_filter: { allow } }),
  });

  it("is each server's id followed by the tool's own name, so two servers can both offer a tool called search", async () => {
    const relay = await startToolServer(["search", "get_page"]);
    const tools = toolsFromMetadata(metadataWithMcp([server("docs"), server("files")] as never), { url: relay.url });
    try {
      expect((await tools.list()).map((tool) => [tool.name, tool.serverId])).toEqual([
        ["docs__search", "https://docs.example.com/mcp"],
        ["docs__get_page", "https://docs.example.com/mcp"],
        ["files__search", "https://files.example.com/mcp"],
        ["files__get_page", "https://files.example.com/mcp"],
      ]);
    } finally {
      await tools.dispose?.();
      await relay.close();
    }
  });

  it("applies the file's tool_filter to the server's own names, and runs the tool under its own name", async () => {
    const relay = await startToolServer(["search", "get_page"]);
    const tools = toolsFromMetadata(metadataWithMcp([server("docs", ["get_page"])] as never), { url: relay.url });
    try {
      expect((await tools.list()).map((tool) => tool.name)).toEqual(["docs__get_page"]);
      const result = await tools.execute({ id: "1", name: "docs__get_page", args: {} }, new AbortController().signal);
      expect(result).toEqual({ ok: true, content: "ran get_page" });
    } finally {
      await tools.dispose?.();
      await relay.close();
    }
  });

  it("is refused, naming both servers and the tool, when two servers' names reduce to the same id", async () => {
    const relay = await startToolServer(["search"]);
    const tools = toolsFromMetadata(metadataWithMcp([server("my_docs"), server("my-docs")] as never), { url: relay.url });
    try {
      await expect(tools.list()).rejects.toThrow(/'my_docs' and 'my-docs'.*'search'.*'my-docs__search'/);
    } finally {
      await tools.dispose?.();
      await relay.close();
    }
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

  it("fails a response bigger than 10 MB, whoever asked for it", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("x".repeat(11 * 1024 * 1024))) as unknown as typeof fetch;
    try {
      await expect(createProxiedFetch({ url: "https://proxy.example.com/" })("https://auth.example.com/metadata")).rejects.toThrow(/larger than 10 MB/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails a response bigger than the limit it was given", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1))) as unknown as typeof fetch;
    try {
      const small = createProxiedFetch({ url: "https://proxy.example.com/" }, 1024 * 1024);
      await expect(small("https://files.example.com/a.afm.md")).rejects.toThrow(/larger than 1 MB/);
      await expect(createProxiedFetch({ url: "https://proxy.example.com/" })("https://files.example.com/a.afm.md")).resolves.toBeInstanceOf(Response);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("counts an event stream as a whole, since only a tool server's connection is read message by message", async () => {
    const message = `data: ${"x".repeat(512 * 1024)}\n\n`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(message.repeat(3), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    try {
      await expect(createProxiedFetch({ url: "https://proxy.example.com/" }, 1024 * 1024)("https://files.example.com/a.afm.md")).rejects.toThrow(/larger than 1 MB/);
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

describe("the proxy session id, through the real code paths", () => {
  const PROXY = "https://proxy.example.net/relay";
  const SESSION_HEADER = "X-Choreo-Correlation-Id";
  const SESSION_ID = "afm-3f2b8c1e-5a47-4d0e-9b1c-7e6a2d9f4c10";

  let imports: { toolsFromMetadata: typeof toolsFromMetadata; createProxiedFetch: typeof createProxiedFetch };
  let resolveMcpServerAuth: typeof import("./mcp-servers").resolveMcpServerAuth;
  let calls: { method: string; target: string | null; sessionId: string | null }[];

  beforeEach(async () => {
    vi.resetModules();
    imports = await import("./tool-factory");
    ({ resolveMcpServerAuth } = await import("./mcp-servers"));
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function json(body: unknown, init: ResponseInit = {}): Response {
    return Response.json(body, init);
  }

  function stubProxy(answer: (method: string, target: string, body: { method?: string; id?: number; params?: { protocolVersion?: string } }) => Response) {
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const target = new URL(String(input)).searchParams.get("target");
      calls.push({ method, target, sessionId: new Headers(init?.headers).get(SESSION_HEADER) });
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return answer(method, target ?? "", body);
    });
  }

  it("goes with the OAuth discovery, client registration, token and MCP calls of one connection", async () => {
    stubProxy((method, target, body) => {
      const first = { [SESSION_HEADER]: SESSION_ID };
      if (target === "https://auth.example.com/token") return json({ access_token: "t", expires_in: 3600 }, { headers: first });
      if (method === "POST" && body.method === "initialize") {
        return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "s", version: "0" } } });
      }
      if (method === "POST" && body.method === "tools/list") return json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      if (method === "POST") return new Response(null, { status: 202 });
      return new Response(null, { status: 405 });
    });
    const metadata = metadataWithMcp([
      {
        ...httpServer("a"),
        transport: {
          ...httpServer("a").transport,
          authentication: { type: "oauth2", grant_type: "client_credentials", token_url: "https://auth.example.com/token", client_id: "i", client_secret: "s" },
        },
      } as never,
    ]);

    await imports.toolsFromMetadata(metadata, { url: PROXY }).list();

    expect(calls[0]).toMatchObject({ method: "POST", target: "https://auth.example.com/token", sessionId: null });
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.slice(1).map((call) => call.sessionId)).toEqual(calls.slice(1).map(() => SESSION_ID));
    expect(calls.map((call) => call.method)).toContain("GET");
    expect(calls.every((call) => call.target !== null)).toBe(true);
  });

  it("goes with server discovery and client registration when a server is added", async () => {
    stubProxy((method, target) => {
      if (method === "POST" && target === "https://mcp.example.com/mcp") {
        const challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"';
        return new Response(null, { status: 401, headers: { "www-authenticate": challenge, [SESSION_HEADER]: SESSION_ID } });
      }
      if (target === "https://mcp.example.com/.well-known/oauth-protected-resource") {
        return json({ resource: "https://mcp.example.com/mcp", authorization_servers: ["https://auth.example.com"] });
      }
      if (target === "https://auth.example.com/.well-known/oauth-authorization-server") {
        return json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          code_challenge_methods_supported: ["S256"],
        });
      }
      return json({ client_id: "registered" });
    });

    const found = await resolveMcpServerAuth("https://mcp.example.com/mcp", imports.createProxiedFetch({ url: PROXY }), undefined, "https://app.example.com/");

    expect(found?.clientId).toBe("registered");
    expect(calls.map((call) => `${call.method} ${call.target}`)).toEqual([
      "POST https://mcp.example.com/mcp",
      "GET https://mcp.example.com/.well-known/oauth-protected-resource",
      "GET https://auth.example.com/.well-known/oauth-authorization-server",
      "POST https://auth.example.com/register",
    ]);
    expect(calls.map((call) => call.sessionId)).toEqual([null, SESSION_ID, SESSION_ID, SESSION_ID]);
  });
});

describe("agentFileFetch", () => {
  it("does not fetch a file directly when no proxy is configured", async () => {
    if (defaultMcpProxyConfig !== null) return;
    const originalFetch = globalThis.fetch;
    const direct = vi.fn(async () => new Response("---\n---"));
    globalThis.fetch = direct as unknown as typeof fetch;
    try {
      await expect(agentFileFetch()("https://files.example.com/a.afm.md")).rejects.toBeInstanceOf(McpProxyRequiredError);
      expect(direct).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("a tool server's event stream", () => {
  const MESSAGE_BYTES = 6 * 1024 * 1024;

  function startStreamingServer(): Promise<{ url: string; close: () => Promise<void> }> {
    const httpServer: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const message = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { id?: number; method?: string; params?: { protocolVersion?: string } };
      const reply = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      if (String(message.method).startsWith("notifications/")) {
        res.writeHead(202);
        return res.end();
      }
      if (message.method === "initialize") return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "s", version: "0" } });
      if (message.method === "tools/list") return reply({ tools: [{ name: "run", description: "", inputSchema: { type: "object", properties: {} } }] });
      if (message.method === "tools/call") {
        const event = (payload: unknown) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s" });
        for (let n = 0; n < 2; n += 1) res.write(event({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "A".repeat(MESSAGE_BYTES) } }));
        return res.end(event({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "finished" }] } }));
      }
      res.writeHead(400);
      res.end();
    });
    return new Promise((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        const { port } = httpServer.address() as { port: number };
        resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((done) => httpServer.close(() => done())) });
      });
    });
  }

  it("is read one message at a time, so a stream longer than the limit in total still gets through", async () => {
    const relay = await startStreamingServer();
    const tools = toolsFromMetadata(metadataWithMcp([{ name: "s", transport: { type: "http", url: "https://s.example.com/mcp" } }] as never), { url: relay.url });
    try {
      await tools.list();
      const result = await tools.execute({ id: "1", name: "s__run", args: {} }, new AbortController().signal);
      expect(result).toEqual({ ok: true, content: "finished" });
    } finally {
      await tools.dispose?.();
      await relay.close();
    }
  }, 30_000);
});
