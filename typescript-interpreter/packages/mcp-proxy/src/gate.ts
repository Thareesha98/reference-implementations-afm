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

import type { ProxyConfig } from "./config";
import type { SafeTarget } from "./ssrf";
import { assertSafeTarget, SsrfError } from "./ssrf";

export interface ProxyRequestInfo {
  method: string;
  origin: string | undefined;
  targetUrl: string | undefined;
}

export type GateResult =
  | { ok: true; target: SafeTarget }
  | { ok: false; status: number; message: string };

export async function gateRequest(info: ProxyRequestInfo, config: ProxyConfig): Promise<GateResult> {
  if (info.method !== "GET" && info.method !== "POST" && info.method !== "DELETE") {
    return { ok: false, status: 405, message: "Method not allowed" };
  }
  if (info.origin === undefined || !config.allowedOrigins.includes(info.origin)) {
    return { ok: false, status: 403, message: "Origin not allowed" };
  }
  if (info.targetUrl === undefined || info.targetUrl === "") {
    return { ok: false, status: 400, message: "Missing target URL" };
  }

  try {
    const target = await assertSafeTarget(info.targetUrl, config.resolve, config.allowLoopback);
    return { ok: true, target };
  } catch (error) {
    if (error instanceof SsrfError) {
      return { ok: false, status: error.status, message: error.message };
    }
    return { ok: false, status: 502, message: "Failed to validate target" };
  }
}

const DEFAULT_ALLOWED_HEADERS =
  "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id";

export function corsHeaders(
  requestOrigin: string | undefined,
  allowedOrigins: string[],
  requestedHeaders?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      requestedHeaders !== undefined && requestedHeaders !== ""
        ? requestedHeaders
        : DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
    "Access-Control-Max-Age": "600",
    Vary: "Origin, Access-Control-Request-Headers",
  };
  if (requestOrigin !== undefined && allowedOrigins.includes(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }
  return headers;
}
