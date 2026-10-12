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
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  Server,
  ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { configFromEnv } from "./config";
import type { ProxyConfig } from "./config";
import { gateRequest, corsHeaders } from "./gate";
import { openUpstream } from "./forward";
import type { UpstreamConnection } from "./forward";
import { createRateLimiter, isAllowedTarget, clientIpFor } from "./limits";
import type { RateLimiter } from "./limits";

const GLOBAL_BUCKET = "all";

function headerString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseRequestUrl(raw: string | undefined): URL | null {
  try {
    return new URL(raw ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function buildResponseHeaders(
  upstream: IncomingHttpHeaders,
  cors: Record<string, string>,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(upstream)) {
    const lower = name.toLowerCase();
    if (value === undefined) continue;
    if (lower.startsWith("access-control-")) continue;
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === "set-cookie") continue;
    out[name] = value;
  }
  return { ...out, ...cors };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: ProxyConfig,
  limiter: RateLimiter,
  globalLimiter: RateLimiter,
): Promise<void> {
  const origin = headerString(req.headers.origin);
  const requestedHeaders = headerString(req.headers["access-control-request-headers"]);
  const cors = corsHeaders(origin, config.allowedOrigins, requestedHeaders);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const requestUrl = parseRequestUrl(req.url);
  if (requestUrl === null) {
    res.writeHead(400, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request URL" }));
    return;
  }

  const client = clientIpFor(req.headers, req.socket.remoteAddress, config.trustedProxyHops);
  if (!limiter.take(client) || !globalLimiter.take(GLOBAL_BUCKET)) {
    res.writeHead(429, { ...cors, "content-type": "application/json", "retry-after": "60" });
    res.end(JSON.stringify({ error: "Too many requests" }));
    return;
  }

  const requestedTarget = requestUrl.searchParams.get("target");
  if (requestedTarget !== null && !isAllowedTarget(requestedTarget, config.allowedTargetHosts)) {
    res.writeHead(403, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Target host is not allowed" }));
    return;
  }

  const gate = await gateRequest(
    {
      method: req.method ?? "GET",
      origin,
      targetUrl: requestUrl.searchParams.get("target") ?? undefined,
    },
    config,
  );

  if (!gate.ok) {
    res.writeHead(gate.status, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: gate.message }));
    return;
  }

  let body: Buffer;
  try {
    body = await readBody(req, config.maxBodyBytes);
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError;
    res.writeHead(tooLarge ? 413 : 400, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: tooLarge ? "Request body too large" : "Could not read request body" }));
    return;
  }

  const controller = new AbortController();
  let connection: UpstreamConnection | undefined;
  let clientGone = false;

  const deadline = setTimeout(() => {
    controller.abort();
    if (res.headersSent) {
      connection?.abort();
      res.destroy();
    }
  }, config.maxUpstreamMs);
  const clearDeadline = () => clearTimeout(deadline);

  res.on("close", () => {
    clientGone = true;
    clearDeadline();
    controller.abort();
    connection?.abort();
  });

  try {
    connection = await openUpstream(
      gate.target,
      { method: req.method ?? "GET", headers: req.headers, body },
      controller.signal,
    );
  } catch {
    clearDeadline();
    if (clientGone) return;
    if (controller.signal.aborted) {
      res.writeHead(504, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream timed out" }));
    } else {
      res.writeHead(502, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream request failed" }));
    }
    return;
  }

  const upstream = connection.response;
  res.writeHead(upstream.statusCode ?? 502, buildResponseHeaders(upstream.headers, cors));
  upstream.pipe(res);
  upstream.on("error", () => res.destroy());

  let received = 0;
  upstream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > config.maxResponseBytes) {
      connection?.abort();
      res.destroy();
    }
  });

  upstream.on("end", clearDeadline);
  upstream.on("close", clearDeadline);
}

export function createProxyServer(config: ProxyConfig): Server {
  const limiter = createRateLimiter({
    requestsPerMinute: config.requestsPerMinute,
    burst: config.burst,
  });
  const globalLimiter = createRateLimiter({
    requestsPerMinute: config.globalRequestsPerMinute,
    burst: config.globalBurst,
  });
  return createServer((req, res) => {
    handle(req, res, config, limiter, globalLimiter).catch(() => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    });
  });
}

const isMain = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const config = configFromEnv();
  if (config.allowLoopback) {
    console.warn("AFM_ALLOW_LOOPBACK=1: loopback addresses and plain http are allowed. Development only.");
  }
  createProxyServer(config).listen(config.port, () => {
    console.log(
      `MCP proxy listening on :${config.port} (allowed origins: ${config.allowedOrigins.join(", ")})`,
    );
  });
}
