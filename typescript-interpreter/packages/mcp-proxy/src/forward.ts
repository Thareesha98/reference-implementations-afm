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

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http";
import type { RequestOptions } from "node:https";
import type { SafeTarget } from "./ssrf";

export interface ForwardRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface UpstreamConnection {
  response: IncomingMessage;
  abort: () => void;
}

const BLOCKED_REQUEST_HEADERS = new Set([
  "host",
  "origin",
  "cookie",
  "referer",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "via",
  "x-real-ip",
  "x-client-ip",
  "client-ip",
  "x-amzn-trace-id",
]);

export function forwardedRequestHeaders(
  headers: IncomingHttpHeaders,
  host: string,
  bodyLength: number,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = { host };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(lower) || lower.startsWith("x-forwarded-")) continue;
    out[name] = value;
  }
  if (bodyLength > 0) {
    out["content-length"] = String(bodyLength);
  }
  return out;
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export function openUpstream(
  target: SafeTarget,
  req: ForwardRequest,
  signal: AbortSignal,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<UpstreamConnection> {
  return attempt(target, req, 0, signal, connectTimeoutMs);
}

function attempt(
  target: SafeTarget,
  req: ForwardRequest,
  index: number,
  signal: AbortSignal,
  connectTimeoutMs: number,
): Promise<UpstreamConnection> {
  const pinnedIp = target.addresses[index];
  if (pinnedIp === undefined) {
    return Promise.reject(new Error("Could not connect to any resolved address"));
  }
  return connectOnce(target, req, pinnedIp, signal, connectTimeoutMs).catch((error: unknown) => {
    if (!signal.aborted && index + 1 < target.addresses.length) {
      return attempt(target, req, index + 1, signal, connectTimeoutMs);
    }
    throw error;
  });
}

function connectOnce(
  target: SafeTarget,
  req: ForwardRequest,
  pinnedIp: string,
  signal: AbortSignal,
  connectTimeoutMs: number,
): Promise<UpstreamConnection> {
  const isHttps = target.url.protocol === "https:";
  const port = target.url.port !== "" ? Number(target.url.port) : isHttps ? 443 : 80;

  const options: RequestOptions = {
    host: target.url.hostname,
    port,
    path: target.url.pathname + target.url.search,
    method: req.method,
    headers: forwardedRequestHeaders(req.headers, target.url.host, req.body.length),
    servername: target.url.hostname,
    signal,
    lookup: (_hostname, options, callback) => {
      const family = pinnedIp.includes(":") ? 6 : 4;
      if (options.all === true) {
        callback(null, [{ address: pinnedIp, family }]);
      } else {
        callback(null, pinnedIp, family);
      }
    },
  };

  return new Promise<UpstreamConnection>((resolve, reject) => {
    let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      clientRequest.destroy(new Error("Connect timed out"));
    }, connectTimeoutMs);
    const clearConnectTimer = (): void => {
      if (connectTimer !== null) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };

    const clientRequest: ClientRequest = (isHttps ? httpsRequest : httpRequest)(options, (response) => {
      clearConnectTimer();
      resolve({ response, abort: () => clientRequest.destroy() });
    });

    clientRequest.on("socket", (socket) => {
      if (!socket.connecting) {
        clearConnectTimer();
        return;
      }
      socket.once(isHttps ? "secureConnect" : "connect", clearConnectTimer);
    });

    clientRequest.on("error", (error) => {
      clearConnectTimer();
      reject(error);
    });
    if (req.body.length > 0) {
      clientRequest.write(req.body);
    }
    clientRequest.end();
  });
}
