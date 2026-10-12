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

import { lookup } from "node:dns/promises";
import type { Resolver } from "./ssrf";

export interface ProxyConfig {
  allowedOrigins: string[];
  port: number;
  resolve: Resolver;
  allowLoopback: boolean;
  requestsPerMinute: number;
  burst: number;
  globalRequestsPerMinute: number;
  globalBurst: number;
  maxBodyBytes: number;
  maxResponseBytes: number;
  maxUpstreamMs: number;
  allowedTargetHosts: string[];
  trustedProxyHops: number;
}

export function dnsResolver(): Resolver {
  return async (hostname) => {
    const results = await lookup(hostname, { all: true });
    return results.map((entry) => entry.address);
  };
}

export function configFromEnv(): ProxyConfig {
  const allowedOrigins = (process.env.AFM_ALLOWED_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin.length > 0);
  return {
    allowedOrigins,
    port: Number(process.env.PORT ?? 8787),
    resolve: dnsResolver(),
    allowLoopback: process.env.AFM_ALLOW_LOOPBACK === "1",
    requestsPerMinute: positiveNumber(process.env.AFM_RATE_PER_MINUTE, 120),
    burst: positiveNumber(process.env.AFM_RATE_BURST, 30),
    globalRequestsPerMinute: positiveNumber(process.env.AFM_GLOBAL_RATE_PER_MINUTE, 1_200),
    globalBurst: positiveNumber(process.env.AFM_GLOBAL_BURST, 300),
    maxBodyBytes: positiveNumber(process.env.AFM_MAX_BODY_BYTES, 1_000_000),
    maxResponseBytes: positiveNumber(process.env.AFM_MAX_RESPONSE_BYTES, 10_000_000),
    maxUpstreamMs: positiveNumber(process.env.AFM_MAX_UPSTREAM_MS, 120_000),
    allowedTargetHosts: (process.env.AFM_ALLOWED_TARGET_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
    trustedProxyHops: hopCount(process.env.AFM_TRUSTED_PROXY_HOPS, 1),
  };
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hopCount(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
