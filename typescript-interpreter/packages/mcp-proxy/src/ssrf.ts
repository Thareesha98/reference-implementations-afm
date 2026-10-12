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

export function isBlockedIp(ip: string, allowLoopback = false): boolean {
  if (!ipaddr.isValid(ip)) {
    return true;
  }

  let address = ipaddr.parse(ip);

  if (address.kind() === "ipv6") {
    const v6 = address as InstanceType<typeof ipaddr.IPv6>;
    if (v6.isIPv4MappedAddress()) {
      address = v6.toIPv4Address();
    }
  }

  const range = address.range();
  if (allowLoopback && range === "loopback") {
    return false;
  }
  return range !== "unicast";
}

export class SsrfError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "SsrfError";
    this.status = status;
  }
}

export interface SafeTarget {
  url: URL;
  addresses: string[];
}

export type Resolver = (hostname: string) => Promise<string[]>;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export async function assertSafeTarget(
  rawUrl: string,
  resolve: Resolver,
  allowLoopback = false,
): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid target URL", 400);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Unsupported protocol: ${url.protocol}`, 400);
  }

  const addresses = await resolve(url.hostname);
  if (addresses.length === 0) {
    throw new SsrfError("Target host did not resolve", 400);
  }
  for (const address of addresses) {
    if (isBlockedIp(address, allowLoopback)) {
      throw new SsrfError("Target resolves to a blocked address range", 403);
    }
  }

  if (url.protocol === "http:" && !allowLoopback) {
    throw new SsrfError("Plain http targets are not allowed; use https", 400);
  }

  return { url, addresses };
}
