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
import { gateRequest, corsHeaders } from "./gate";
import type { ProxyConfig } from "./config";
import type { ProxyRequestInfo } from "./gate";

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    allowedOrigins: ["https://app.afm.dev"],
    port: 0,
    resolve: async () => ["8.8.8.8"],
    allowLoopback: false,
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

const base: ProxyRequestInfo = {
  method: "POST",
  origin: "https://app.afm.dev",
  targetUrl: "https://mcp.example.com/rpc",
};

describe("gateRequest", () => {
  it("accepts a fully valid request", async () => {
    const result = await gateRequest(base, makeConfig());
    expect(result.ok).toBe(true);
  });

  it("accepts DELETE (MCP session teardown)", async () => {
    const result = await gateRequest({ ...base, method: "DELETE" }, makeConfig());
    expect(result.ok).toBe(true);
  });

  it("rejects a disallowed method (405)", async () => {
    const result = await gateRequest({ ...base, method: "PUT" }, makeConfig());
    expect(result).toMatchObject({ ok: false, status: 405 });
  });

  it("rejects a wrong origin (403)", async () => {
    const result = await gateRequest({ ...base, origin: "https://evil.com" }, makeConfig());
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a missing target (400)", async () => {
    const result = await gateRequest({ ...base, targetUrl: undefined }, makeConfig());
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a target resolving to a private IP (403)", async () => {
    const result = await gateRequest(base, makeConfig({ resolve: async () => ["10.0.0.1"] }));
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe("gateRequest with several allowed origins", () => {
  it("accepts either configured origin and rejects anything else", async () => {
    const config = makeConfig({
      allowedOrigins: ["https://afm.example.com", "https://calm-x.azurestaticapps.net"],
    });
    for (const origin of config.allowedOrigins) {
      expect((await gateRequest({ ...base, origin }, config)).ok).toBe(true);
    }
    const bad = await gateRequest({ ...base, origin: "https://evil.example" }, config);
    expect(bad.ok).toBe(false);
  });

  it("rejects a request with no Origin header at all", async () => {
    const result = await gateRequest({ ...base, origin: undefined }, makeConfig());
    expect(result.ok).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("echoes the allowed origin when it matches", () => {
    const headers = corsHeaders("https://app.afm.dev", ["https://app.afm.dev"]);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.afm.dev");
  });

  it("omits allow-origin for a non-matching origin", () => {
    const headers = corsHeaders("https://evil.com", ["https://app.afm.dev"]);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("omits allow-origin when there is no Origin header", () => {
    const headers = corsHeaders(undefined, ["https://app.afm.dev"]);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("advertises POST and DELETE, and varies on origin + requested headers", () => {
    const headers = corsHeaders("x", ["y"]);
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(headers["Access-Control-Allow-Methods"]).toContain("DELETE");
    expect(headers["Vary"]).toBe("Origin, Access-Control-Request-Headers");
  });

  it("reflects the headers the browser asks to send", () => {
    const headers = corsHeaders("x", ["y"], "authorization, x-api-key");
    expect(headers["Access-Control-Allow-Headers"]).toBe("authorization, x-api-key");
  });

  it("falls back to a default header list (incl. authorization) when none requested", () => {
    const headers = corsHeaders("x", ["y"]);
    expect(headers["Access-Control-Allow-Headers"]).toContain("authorization");
  });

  it("exposes mcp-session-id and www-authenticate - both are read from JS, and a proxied response is cross-origin from the page's own point of view", () => {
    const headers = corsHeaders("x", ["y"]);
    expect(headers["Access-Control-Expose-Headers"]).toContain("mcp-session-id");
    expect(headers["Access-Control-Expose-Headers"]).toContain("www-authenticate");
  });
});

describe("corsHeaders with several allowed origins", () => {
  const allowed = ["https://afm.example.com", "https://calm-x.azurestaticapps.net"];

  it("echoes back whichever allowed origin made the request", () => {
    expect(corsHeaders(allowed[0], allowed)["Access-Control-Allow-Origin"]).toBe(allowed[0]);
    expect(corsHeaders(allowed[1], allowed)["Access-Control-Allow-Origin"]).toBe(allowed[1]);
  });

  it("still refuses an origin that is not listed", () => {
    expect(corsHeaders("https://evil.example", allowed)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("never answers with a wildcard", () => {
    for (const origin of [...allowed, "https://evil.example", undefined]) {
      expect(corsHeaders(origin, allowed)["Access-Control-Allow-Origin"]).not.toBe("*");
    }
  });
});
