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

import { connect, createServer as createNetServer } from "node:net";
import type { Socket } from "node:net";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createProxyServer } from "./server";
import type { ProxyConfig } from "./config";

const ALLOWED_ORIGIN = "https://app.afm.dev";

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    allowedOrigins: [ALLOWED_ORIGIN],
    port: 0,
    resolve: async () => ["127.0.0.1"],
    allowLoopback: true,
    requestsPerMinute: 1000,
    burst: 1000,
    globalRequestsPerMinute: 10_000,
    globalBurst: 10_000,
    maxBodyBytes: 1_000_000,
    maxResponseBytes: 10_000_000,
    maxUpstreamMs: 120_000,
    allowedTargetHosts: [],
    trustedProxyHops: 0,
    ...overrides,
  };
}

interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<RunningServer> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
            server.closeAllConnections();
          }),
      });
    });
  });
}

function startTarget(requiredHeader?: { name: string; value: string }): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const headerName = requiredHeader?.name.toLowerCase();
    const received = headerName !== undefined ? req.headers[headerName] : undefined;

    if (requiredHeader !== undefined && received !== requiredHeader.value) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        sawAuthorization: req.headers.authorization ?? null,
        sawApiKey: req.headers["x-api-key"] ?? null,
      }),
    );
  });
  return listen(server);
}

/** A target that accepts the connection and never answers, for exercising the upstream timers. */
function startSilentTarget(): Promise<RunningServer & { sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createNetServer((socket) => {
    socket.resume();
    sockets.push(socket);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((res) => server.close(() => res())), sockets });
    });
  });
}

/** A target that answers with `bytes` bytes of body, for exercising the response cap. */
function startBulkTarget(bytes: number): Promise<RunningServer> {
  const server = createServer((_req, res) => {
    res.on("error", () => {});
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.alloc(bytes, 0x61));
  });
  return listen(server);
}

describe("the assembled proxy (gate → SSRF → forward → CORS), with authenticated targets", () => {
  let target: RunningServer | null = null;
  let proxy: RunningServer | null = null;

  afterEach(async () => {
    await target?.close();
    await proxy?.close();
    target = null;
    proxy = null;
  });

  it("relays a bearer-authenticated request end to end", async () => {
    target = await startTarget({ name: "authorization", value: "Bearer secret-token" });
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sawAuthorization: string | null };
    expect(body.sawAuthorization).toBe("Bearer secret-token");
  });

  it("does not pass an upstream cookie on to the browser, since every server shares the proxy's origin", async () => {
    const cookieServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "session=abc; Path=/", "x-kept": "yes" });
      res.end("{}");
    });
    target = await listen(cookieServer);
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-kept")).toBe("yes");
  });

  it("relays a custom api-key header end to end", async () => {
    target = await startTarget({ name: "x-api-key", value: "k-123" });
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN, "x-api-key": "k-123" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sawApiKey: string | null };
    expect(body.sawApiKey).toBe("k-123");
  });

  it("rejects a disallowed origin with 403 — and never contacts the target at all", async () => {
    let targetWasHit = false;
    const raw = createServer((_req, res) => {
      targetWasHit = true;
      res.writeHead(200).end("{}");
    });
    target = await listen(raw);
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: { Origin: "https://evil.com" },
      body: "{}",
    });

    expect(res.status).toBe(403);
    expect(targetWasHit).toBe(false);
  });

  it("faithfully relays the TARGET's own 401 when the proxy's gate passes but the tool's own auth is wrong", async () => {
    target = await startTarget({ name: "authorization", value: "Bearer correct-token" });
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        authorization: "Bearer wrong-token",
      },
      body: "{}",
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("answers a CORS preflight (OPTIONS) with the allow-origin stamp, before any gate check", async () => {
    proxy = await listen(createProxyServer(makeConfig()));

    const res = await fetch(`${proxy.url}?target=https://ignored.example.com/`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
  });

  it("bounds the relay as a whole even when the caller rotates addresses", async () => {
    target = await startTarget();
    proxy = await listen(
      createProxyServer(
        makeConfig({
          // Per client, nothing is in the way; the global bucket is the only thing counting.
          requestsPerMinute: 10_000,
          burst: 10_000,
          globalRequestsPerMinute: 60,
          globalBurst: 2,
          trustedProxyHops: 1,
        }),
      ),
    );

    const send = (clientIp: string) =>
      fetch(`${proxy!.url}?target=${encodeURIComponent(target!.url)}`, {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          "x-forwarded-for": clientIp,
        },
        body: "{}",
      });

    expect((await send("203.0.113.1")).status).toBe(200);
    expect((await send("203.0.113.2")).status).toBe(200);
    // A third, unrelated address - the per-client limiter is happy, the global cap is not.
    expect((await send("203.0.113.3")).status).toBe(429);
  });

  it("answers 504 when the upstream accepts the connection but never answers, within the deadline", async () => {
    const silent = await startSilentTarget();
    proxy = await listen(createProxyServer(makeConfig({ maxUpstreamMs: 300 })));

    const started = Date.now();
    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(silent.url)}`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
      body: "{}",
    });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "Upstream timed out" });
    await vi.waitFor(() => expect(silent.sockets[0]?.destroyed).toBe(true));
    await silent.close();
  });

  it("closes the upstream connection when the browser leaves before the upstream ever answers", async () => {
    const silent = await startSilentTarget();
    proxy = await listen(createProxyServer(makeConfig({ maxUpstreamMs: 30_000 })));

    const controller = new AbortController();
    const p = fetch(`${proxy.url}?target=${encodeURIComponent(silent.url)}`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
      body: "{}",
      signal: controller.signal,
    }).catch(() => {});
    await vi.waitFor(() => expect(silent.sockets).toHaveLength(1));
    controller.abort();
    await p;

    await vi.waitFor(() => expect(silent.sockets[0]?.destroyed).toBe(true));
    await silent.close();
  });

  it("cuts off a response that runs past the size cap", async () => {
    target = await startBulkTarget(400_000);
    proxy = await listen(createProxyServer(makeConfig({ maxResponseBytes: 50_000 })));

    // The overrun is detected while the body streams, after the status line is already on its
    // way, so the cut surfaces as a dropped transfer rather than a status code - and depending on
    // how much the socket had flushed, it can land on either the headers or the body.
    await expect(
      fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
        method: "POST",
        headers: { Origin: ALLOWED_ORIGIN },
        body: "{}",
      }).then((res) => res.arrayBuffer()),
    ).rejects.toThrow();
  });

  it("passes a response under the cap through intact", async () => {
    target = await startBulkTarget(10_000);
    proxy = await listen(createProxyServer(makeConfig({ maxResponseBytes: 50_000 })));

    const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(10_000);
  });

  it("never writes a credential, or the target, anywhere it could be logged", async () => {
    const seen: string[] = [];
    const record = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
    const spies = [
      vi.spyOn(console, "log").mockImplementation(record),
      vi.spyOn(console, "info").mockImplementation(record),
      vi.spyOn(console, "warn").mockImplementation(record),
      vi.spyOn(console, "error").mockImplementation(record),
      vi.spyOn(console, "debug").mockImplementation(record),
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        seen.push(String(chunk));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        seen.push(String(chunk));
        return true;
      }),
    ];

    try {
      target = await startTarget({ name: "authorization", value: "Bearer SUPER-SECRET-VALUE" });
      proxy = await listen(createProxyServer(makeConfig()));

      const res = await fetch(`${proxy.url}?target=${encodeURIComponent(target.url)}`, {
        method: "POST",
        headers: {
          Origin: ALLOWED_ORIGIN,
          authorization: "Bearer SUPER-SECRET-VALUE",
          "x-api-key": "KEY-SHOULD-NOT-APPEAR",
        },
        body: JSON.stringify({ password: "BODY-SHOULD-NOT-APPEAR" }),
      });
      expect(res.status).toBe(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = seen.join("\n");
    expect(output).not.toContain("SUPER-SECRET-VALUE");
    expect(output).not.toContain("KEY-SHOULD-NOT-APPEAR");
    expect(output).not.toContain("BODY-SHOULD-NOT-APPEAR");
  });

  // A request line the URL parser rejects must be answered, not left to throw inside the async
  // handler: an unhandled rejection there ends the whole process.
  it.each(["//", "http://"])("answers 400 to a request target of %s instead of failing", async (requestTarget) => {
    proxy = await listen(createProxyServer(makeConfig()));
    const port = Number(new URL(proxy.url).port);

    const statusLine = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(`POST ${requestTarget} HTTP/1.1\r\nHost: x\r\nOrigin: ${ALLOWED_ORIGIN}\r\nContent-Length: 0\r\n\r\n`);
      });
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString();
        if (received.includes("\r\n")) {
          socket.destroy();
          resolve(received.split("\r\n")[0] ?? "");
        }
      });
      socket.on("error", reject);
      setTimeout(() => {
        socket.destroy();
        resolve("(no response)");
      }, 1500);
    });

    expect(statusLine).toBe("HTTP/1.1 400 Bad Request");
  });
});
