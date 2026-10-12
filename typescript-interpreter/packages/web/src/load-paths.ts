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

import { findAgent } from "./agents-store";

export type LoadSource =
  | { kind: "inline"; content: string }
  | { kind: "remote"; url: string }
  | { kind: "agent"; id: string }
  | { kind: "none" };

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function encodeInlineAfm(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeInlineAfm(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export type AgentFileUrl = { ok: true; url: string } | { ok: false; error: string };

export function normalizeAgentFileUrl(input: string): AgentFileUrl {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter the URL of your .afm.md file." };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That doesn't look like a full URL - include https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "The URL must start with https://" };
  }

  if (url.host === "gist.github.com" && !/\/raw(\/|$)/.test(url.pathname)) {
    const parts = url.pathname.split("/").filter((part) => part !== "");
    if (parts.length >= 2) {
      return { ok: true, url: `https://gist.github.com/${parts[0]}/${parts[1]}/raw` };
    }
  }

  if (url.host === "github.com" && url.pathname.includes("/blob/")) {
    const [owner, repo, , ...rest] = url.pathname.split("/").filter((part) => part !== "");
    if (owner !== undefined && repo !== undefined && rest.length > 0) {
      return { ok: true, url: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join("/")}` };
    }
  }

  return { ok: true, url: url.toString() };
}

export function inlineAfmParam(search: URLSearchParams, hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get("afm") ?? search.get("afm");
}

export async function resolveContent(
  source: LoadSource,
  fetchFn: typeof fetch,
): Promise<string | null> {
  switch (source.kind) {
    case "inline":
      return source.content;
    case "agent": {
      const saved = findAgent(source.id);
      if (saved === null) {
        throw new Error("This agent isn't in your library anymore - it may have been deleted.");
      }
      return saved.source;
    }
    case "remote": {
      const response = await fetchFn(source.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch agent file: ${response.status} ${response.statusText}`,
        );
      }
      return await response.text();
    }
    case "none":
      return null;
  }
}
