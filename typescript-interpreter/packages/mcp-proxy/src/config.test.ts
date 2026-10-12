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

import { describe, it, expect, afterEach } from "vitest";
import { configFromEnv } from "./config";

const KEYS = [
  "AFM_RATE_PER_MINUTE",
  "AFM_GLOBAL_RATE_PER_MINUTE",
  "AFM_GLOBAL_BURST",
  "AFM_MAX_RESPONSE_BYTES",
  "AFM_TRUSTED_PROXY_HOPS",
  "AFM_ALLOWED_TARGET_HOSTS",
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("configFromEnv", () => {
  it("bounds the relay by default, with no env set", () => {
    const config = configFromEnv();
    expect(config.globalRequestsPerMinute).toBe(1_200);
    expect(config.globalBurst).toBe(300);
    expect(config.maxResponseBytes).toBe(10_000_000);
    expect(config.trustedProxyHops).toBe(1);
  });

  it("keeps the target allowlist off by default, so any MCP server still works", () => {
    expect(configFromEnv().allowedTargetHosts).toEqual([]);
    process.env.AFM_ALLOWED_TARGET_HOSTS = "mcp.context7.com, Example.COM";
    expect(configFromEnv().allowedTargetHosts).toEqual(["mcp.context7.com", "example.com"]);
  });

  it("takes zero hops as a real value, not a missing one", () => {
    process.env.AFM_TRUSTED_PROXY_HOPS = "0";
    expect(configFromEnv().trustedProxyHops).toBe(0);
  });

  it("falls back to the safe default rather than trusting a malformed hop count", () => {
    for (const raw of ["", "-1", "1.5", "lots"]) {
      process.env.AFM_TRUSTED_PROXY_HOPS = raw;
      expect(configFromEnv().trustedProxyHops).toBe(1);
    }
  });

  it("reads the caps that are set and defaults the ones that are not", () => {
    process.env.AFM_GLOBAL_RATE_PER_MINUTE = "500";
    process.env.AFM_MAX_RESPONSE_BYTES = "2048";
    const config = configFromEnv();
    expect(config.globalRequestsPerMinute).toBe(500);
    expect(config.maxResponseBytes).toBe(2048);
    expect(config.globalBurst).toBe(300);
  });
});
