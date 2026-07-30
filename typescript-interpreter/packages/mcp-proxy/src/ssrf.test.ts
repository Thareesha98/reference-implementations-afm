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
import { assertSafeTarget, SsrfError, isBlockedIp } from "./ssrf";

const resolveTo = (ips: string[]) => async () => ips;

describe("assertSafeTarget", () => {
  it("accepts an https URL resolving to a public IP", async () => {
    const target = await assertSafeTarget("https://mcp.example.com/rpc", resolveTo(["93.184.216.34"]));
    expect(target.url.hostname).toBe("mcp.example.com");
    expect(target.addresses).toEqual(["93.184.216.34"]);
  });

  it("rejects plain http to a public host, since credentials would cross the internet unencrypted", async () => {
    await expect(assertSafeTarget("http://mcp.example.com/rpc", resolveTo(["93.184.216.34"]))).rejects.toThrow(
      /https/,
    );
  });

  it("allows plain http when loopback is allowed, which is local development", async () => {
    const target = await assertSafeTarget("http://localhost:3000/mcp", resolveTo(["127.0.0.1"]), true);
    expect(target.url.protocol).toBe("http:");
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeTarget("ftp://x/", resolveTo(["8.8.8.8"]))).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeTarget("file:///etc/passwd", resolveTo([]))).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects an invalid URL", async () => {
    await expect(assertSafeTarget("http://", resolveTo(["8.8.8.8"]))).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects when the host resolves to a private IP", async () => {
    await expect(assertSafeTarget("https://evil.example.com/", resolveTo(["10.0.0.5"]))).rejects.toThrow(
      /blocked/,
    );
  });

  it("rejects when ANY resolved IP is blocked (mixed answers)", async () => {
    await expect(
      assertSafeTarget("https://x.example.com/", resolveTo(["8.8.8.8", "127.0.0.1"])),
    ).rejects.toThrow(/blocked/);
  });

  it("rejects a literal cloud-metadata IP", async () => {
    await expect(
      assertSafeTarget("http://169.254.169.254/latest/meta-data/", resolveTo(["169.254.169.254"])),
    ).rejects.toThrow(/blocked/);
  });

  it("rejects when nothing resolves", async () => {
    await expect(assertSafeTarget("https://x.example.com/", resolveTo([]))).rejects.toThrow(/resolve/);
  });
});

describe("isBlockedIp — IPv4", () => {
  it("allows public unicast", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.99.99.99")).toBe(true);
  });
  it("blocks private ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.5.4")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });
  it("blocks the cloud-metadata address (link-local)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });
  it("blocks unspecified, broadcast, CGNAT", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("255.255.255.255")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
  });
});

describe("isBlockedIp — IPv6", () => {
  it("allows public unicast", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
  it("blocks loopback, link-local, unique-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456:789a::1")).toBe(true);
  });
  it("unwraps IPv4-mapped IPv6 and blocks internal targets", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });
  it("allows an IPv4-mapped IPv6 pointing at a public address", () => {
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isBlockedIp — dev loopback override", () => {
  it("permits loopback only when allowLoopback is true (still blocks other private ranges)", () => {
    expect(isBlockedIp("127.0.0.1", true)).toBe(false);
    expect(isBlockedIp("::1", true)).toBe(false);
    expect(isBlockedIp("::ffff:127.0.0.1", true)).toBe(false);
    expect(isBlockedIp("10.0.0.1", true)).toBe(true);
    expect(isBlockedIp("169.254.169.254", true)).toBe(true);
  });
});

describe("isBlockedIp — garbage", () => {
  it("blocks anything unparseable", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("999.999.999.999")).toBe(true);
  });
});
