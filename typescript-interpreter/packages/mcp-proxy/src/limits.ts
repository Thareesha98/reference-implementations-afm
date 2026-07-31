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

import ipaddr from "ipaddr.js";
import type { IncomingHttpHeaders } from "node:http";

// Origin can be forged outside a browser, so it does not authenticate the caller. The proxy bounds
// abuse instead: rate limits, size caps and time caps.

export interface RateLimitConfig {
  requestsPerMinute: number;
  burst: number;
}

export interface RateLimiter {
  take(key: string, now?: number): boolean;
  size(): number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const SWEEP_AFTER_MS = 10 * 60 * 1000;

// Token bucket per client IP: bursts are allowed, sustained floods are not.
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const perMs = config.requestsPerMinute / 60_000;

  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > SWEEP_AFTER_MS) buckets.delete(key);
    }
  }

  return {
    take(key: string, now = Date.now()): boolean {
      if (config.requestsPerMinute <= 0) return true;

      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, { tokens: config.burst - 1, updatedAt: now });
        if (buckets.size % 256 === 0) sweep(now);
        return true;
      }

      const refilled = Math.min(config.burst, bucket.tokens + (now - bucket.updatedAt) * perMs);
      bucket.updatedAt = now;
      if (refilled < 1) {
        bucket.tokens = refilled;
        return false;
      }
      bucket.tokens = refilled - 1;
      return true;
    },

    size(): number {
      return buckets.size;
    },
  };
}

// The target allowlist is off by default because an agent file may name any MCP server; a
// deployment with a fixed set can turn it on.
export function isAllowedTarget(target: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true;
  let host: string;
  try {
    host = new URL(target).host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function clientKeyFor(remoteAddress: string | undefined): string {
  return remoteAddress ?? "unknown";
}

// Behind a load balancer the socket address is the balancer, not the caller. The caller is in
// X-Forwarded-For, which each proxy appends to, so only the rightmost entries are trustworthy:
// count in from the right by the number of trusted hops, never from the left.
//
// Hops: 1 for Azure App Service or an AWS ALB in append mode, 2 for a Google Cloud external load
// balancer ("<client-ip>,<lb-ip>"), 0 for nothing in front (use the socket address). When unsure,
// err low: too high reaches the part of the header the caller wrote.
export function clientIpFor(
  headers: IncomingHttpHeaders,
  socketAddress: string | undefined,
  trustedProxyHops: number,
): string {
  if (trustedProxyHops <= 0) return clientKeyFor(socketAddress);

  const raw = headers["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw.join(",") : raw;
  if (header === undefined) return clientKeyFor(socketAddress);

  const entries = header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  // Fewer entries than trusted hops means the request did not come through the expected chain, so
  // fall back to the socket address.
  const ip = forwardedIp(entries[entries.length - trustedProxyHops]);
  return ip ?? clientKeyFor(socketAddress);
}

function forwardedIp(entry: string | undefined): string | undefined {
  if (entry === undefined) return undefined;
  // Azure appends "ip:port"; IPv6 arrives bracketed, with or without a port.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  const parts = entry.split(":");
  const value = bracketed?.[1] ?? (parts.length === 2 ? (parts[0] as string) : entry);
  return ipaddr.isValid(value) ? value : undefined;
}
