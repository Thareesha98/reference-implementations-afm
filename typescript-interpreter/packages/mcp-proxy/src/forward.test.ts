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

import { createServer } from "node:http";
import { describe, it, expect, afterEach } from "vitest";
import { forwardedRequestHeaders, openUpstream } from "./forward";
import type { IncomingHttpHeaders } from "node:http";
import type { SafeTarget } from "./ssrf";

const incoming: IncomingHttpHeaders = {
  host: "proxy.local",
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: "Bearer abc",
  "x-api-key": "k-123",
  "mcp-session-id": "s1",
  "last-event-id": "42",
  origin: "http://localhost:5173",
  cookie: "a=b",
  referer: "http://localhost:5173/",
  connection: "keep-alive",
  "transfer-encoding": "chunked",
  "content-length": "999",
};

describe("forwardedRequestHeaders", () => {
  it("forwards auth, custom, mcp, and SSE-resume headers", () => {
    const out = forwardedRequestHeaders(incoming, "api.example.com", 50);
    expect(out.authorization).toBe("Bearer abc");
    expect(out["x-api-key"]).toBe("k-123");
    expect(out["content-type"]).toBe("application/json");
    expect(out.accept).toBe("application/json, text/event-stream");
    expect(out["mcp-session-id"]).toBe("s1");
    expect(out["last-event-id"]).toBe("42");
  });

  it("sets host to the target, not the client's host", () => {
    expect(forwardedRequestHeaders(incoming, "api.example.com", 0).host).toBe("api.example.com");
  });

  it("drops browser context the target has no need for", () => {
    const out = forwardedRequestHeaders(incoming, "api.example.com", 0);
    expect(out.origin).toBeUndefined();
    expect(out.cookie).toBeUndefined();
    expect(out.referer).toBeUndefined();
  });

  it("drops the forwarding headers the hosting platform adds", () => {
    const dropped = [
      "x-forwarded-for",
      "x-forwarded-proto",
      "x-forwarded-port",
      "forwarded",
      "via",
      "x-real-ip",
      "x-client-ip",
      "client-ip",
      "x-amzn-trace-id",
    ];
    const behindBalancer: IncomingHttpHeaders = { ...incoming, ...Object.fromEntries(dropped.map((name) => [name, "203.0.113.7"])) };
    const out = forwardedRequestHeaders(behindBalancer, "api.example.com", 0);
    for (const name of dropped) expect(out[name]).toBeUndefined();
    expect(out["x-api-key"]).toBe("k-123");
  });

  it("drops hop-by-hop / framing headers", () => {
    const out = forwardedRequestHeaders(incoming, "api.example.com", 0);
    expect(out.connection).toBeUndefined();
    expect(out["transfer-encoding"]).toBeUndefined();
  });

  it("sets content-length from the actual body, ignoring the client's", () => {
    expect(forwardedRequestHeaders(incoming, "api.example.com", 50)["content-length"]).toBe("50");
    expect(forwardedRequestHeaders(incoming, "api.example.com", 0)["content-length"]).toBeUndefined();
  });
});


function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

describe("openUpstream", () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
    if (server === null) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  });

  it("falls back to the second address once the first fails to connect in time", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from the second address");
    });
    const port = await listen(server);
    // Never accepted - not routed, so the connect attempt just sits there until our own timer cuts it.
    const target: SafeTarget = { url: new URL(`http://x:${port}/`), addresses: ["10.255.255.1", "127.0.0.1"] };

    const started = Date.now();
    const connection = await openUpstream(target, { method: "GET", headers: {}, body: Buffer.alloc(0) }, new AbortController().signal, 300);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(connection.response.statusCode).toBe(200);
  });

  it("still succeeds when the upstream answers after the connect limit but before the deadline", async () => {
    server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("slow but there");
      }, 700);
    });
    const port = await listen(server);
    const target: SafeTarget = { url: new URL(`http://x:${port}/`), addresses: ["127.0.0.1"] };

    const connection = await openUpstream(target, { method: "GET", headers: {}, body: Buffer.alloc(0) }, new AbortController().signal, 300);

    expect(connection.response.statusCode).toBe(200);
  });

  it("does not fall back once the caller's own signal aborts", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200).end("ok");
    });
    const port = await listen(server);
    const target: SafeTarget = { url: new URL(`http://x:${port}/`), addresses: ["10.255.255.1", "127.0.0.1"] };
    const controller = new AbortController();

    const pending = openUpstream(target, { method: "GET", headers: {}, body: Buffer.alloc(0) }, controller.signal, 10_000);
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("does not time out a slow answer on a socket the agent already had connected", async () => {
    server = createServer((req, res) => {
      setTimeout(() => res.end("second"), 700);
    });
    const port = await listen(server);
    const target: SafeTarget = { url: new URL(`http://x:${port}/`), addresses: ["127.0.0.1"] };
    const call = () => openUpstream(target, { method: "GET", headers: {}, body: Buffer.alloc(0) }, new AbortController().signal, 300);

    const first = await call();
    for await (const _chunk of first.response) {
      /* drain */
    }

    const second = await call();
    expect(second.response.statusCode).toBe(200);
  });

  it("does not time out a slow stream on a socket the agent already had connected", async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: started\n\n");
      setTimeout(() => res.end("data: done\n\n"), 700);
    });
    const port = await listen(server);
    const target: SafeTarget = { url: new URL(`http://x:${port}/`), addresses: ["127.0.0.1"] };
    const call = async () => {
      const { response } = await openUpstream(target, { method: "GET", headers: {}, body: Buffer.alloc(0) }, new AbortController().signal, 300);
      let body = "";
      for await (const chunk of response) body += chunk;
      return body;
    };

    await call();
    expect(await call()).toContain("data: done");
  });
});
