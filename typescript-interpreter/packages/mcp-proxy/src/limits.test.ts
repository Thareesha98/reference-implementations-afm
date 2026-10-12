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

import { describe, it, expect } from "vitest";
import { createRateLimiter, isAllowedTarget, clientKeyFor, clientIpFor } from "./limits";

describe("createRateLimiter", () => {
  it("allows a burst then refuses", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, burst: 3 });
    const now = 1_000_000;
    expect(limiter.take("1.2.3.4", now)).toBe(true);
    expect(limiter.take("1.2.3.4", now)).toBe(true);
    expect(limiter.take("1.2.3.4", now)).toBe(true);
    expect(limiter.take("1.2.3.4", now)).toBe(false);
  });

  it("refills over time", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, burst: 2 });
    const start = 1_000_000;
    limiter.take("ip", start);
    limiter.take("ip", start);
    expect(limiter.take("ip", start)).toBe(false);
    expect(limiter.take("ip", start + 1_100)).toBe(true);
  });

  it("limits each client independently", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, burst: 1 });
    const now = 1_000_000;
    expect(limiter.take("a", now)).toBe(true);
    expect(limiter.take("a", now)).toBe(false);
    expect(limiter.take("b", now)).toBe(true);
  });

  it("never blocks when disabled", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 0, burst: 0 });
    for (let i = 0; i < 100; i++) expect(limiter.take("ip")).toBe(true);
  });
});

describe("isAllowedTarget", () => {
  it("allows everything when no allowlist is configured", () => {
    expect(isAllowedTarget("https://anything.example/mcp", [])).toBe(true);
  });

  it("matches an exact host", () => {
    expect(isAllowedTarget("https://mcp.context7.com/mcp", ["mcp.context7.com"])).toBe(true);
    expect(isAllowedTarget("https://attacker.example/mcp", ["mcp.context7.com"])).toBe(false);
  });

  it("matches subdomains of an allowed host", () => {
    expect(isAllowedTarget("https://a.example.com/mcp", ["example.com"])).toBe(true);
  });

  it("does not treat a suffix as a subdomain", () => {
    expect(isAllowedTarget("https://notexample.com/mcp", ["example.com"])).toBe(false);
  });

  it("rejects an unparseable target when an allowlist is set", () => {
    expect(isAllowedTarget("not-a-url", ["example.com"])).toBe(false);
  });
});

describe("clientKeyFor", () => {
  it("falls back when the address is unknown", () => {
    expect(clientKeyFor(undefined)).toBe("unknown");
    expect(clientKeyFor("1.2.3.4")).toBe("1.2.3.4");
  });
});

const SOCKET = "10.0.0.7";

describe("clientIpFor", () => {
  it("reads the caller Azure's front end appended, port and all", () => {
    expect(clientIpFor({ "x-forwarded-for": "203.0.113.9:51234" }, SOCKET, 1)).toBe("203.0.113.9");
  });

  it("ignores an entry the caller forged to the left of the trusted hop", () => {
    const headers = { "x-forwarded-for": "1.2.3.4, 203.0.113.9" };
    expect(clientIpFor(headers, SOCKET, 1)).toBe("203.0.113.9");
  });

  it("is not fooled by a forged entry that mimics a whole proxy chain", () => {
    const headers = { "x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.9" };
    expect(clientIpFor(headers, SOCKET, 1)).toBe("203.0.113.9");
  });

  it("counts in from the right for a two-hop chain (GCP)", () => {
    const headers = { "x-forwarded-for": "1.2.3.4, 203.0.113.9, 35.191.0.1" };
    expect(clientIpFor(headers, SOCKET, 2)).toBe("203.0.113.9");
  });

  it("falls back to the socket when the header is missing, short, or junk", () => {
    expect(clientIpFor({}, SOCKET, 1)).toBe(SOCKET);
    expect(clientIpFor({ "x-forwarded-for": "203.0.113.9" }, SOCKET, 2)).toBe(SOCKET);
    expect(clientIpFor({ "x-forwarded-for": "" }, SOCKET, 1)).toBe(SOCKET);
    expect(clientIpFor({ "x-forwarded-for": "not-an-ip" }, SOCKET, 1)).toBe(SOCKET);
    expect(clientIpFor({ "x-forwarded-for": ", ," }, SOCKET, 1)).toBe(SOCKET);
  });

  it("ignores the header entirely when nothing is in front of the process", () => {
    expect(clientIpFor({ "x-forwarded-for": "1.2.3.4" }, SOCKET, 0)).toBe(SOCKET);
  });

  it("handles IPv6, bracketed or bare", () => {
    expect(clientIpFor({ "x-forwarded-for": "[2001:db8::1]:443" }, SOCKET, 1)).toBe("2001:db8::1");
    expect(clientIpFor({ "x-forwarded-for": "2001:db8::1" }, SOCKET, 1)).toBe("2001:db8::1");
  });

  it("buckets two callers behind one load balancer separately", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 60, burst: 1 });
    const now = 1_000_000;
    const first = clientIpFor({ "x-forwarded-for": "203.0.113.9:1" }, SOCKET, 1);
    const second = clientIpFor({ "x-forwarded-for": "198.51.100.4:2" }, SOCKET, 1);

    expect(limiter.take(first, now)).toBe(true);
    expect(limiter.take(first, now)).toBe(false);
    expect(limiter.take(second, now)).toBe(true);
  });
});
