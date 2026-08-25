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

import { discoverProtectedResource, discoverAuthorizationServer, registerClient } from "@afm/adapter-auth";
import type { AuthorizationServerMetadata } from "@afm/adapter-auth";
import { proxyAwareFetch } from "./tool-factory";
import { loadJsonArray, saveJson } from "./local-json-store";

/**
 * Search of the official MCP Registry (public, CORS-open, no key), reduced to what this runtime can
 * use: `streamable-http` remotes with a literal URL.
 */

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

interface RegistryKeyValueInput {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryRemote {
  type: string;
  url: string;
  headers?: RegistryKeyValueInput[];
}

interface RegistryServer {
  name: string;
  title?: string;
  description: string;
  remotes?: RegistryRemote[];
  websiteUrl?: string;
  version?: string;
  repository?: { url?: string };
}

interface RegistryRow {
  server: RegistryServer;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: { status?: string; updatedAt?: string };
  };
}

interface RegistrySearchResponse {
  servers?: RegistryRow[];
}

/**
 * Who owns the namespace and how it was proved: a DNS/HTTPS challenge for a domain, a GitHub login
 * for `io.github.*`. The kind of identity tells whether a server called "Notion" came from Notion.
 */
export interface Publisher {
  kind: "domain" | "github";
  label: string;
}

/** A declared credential the server will want. Absent means OAuth, or nothing at all. */
export interface DeclaredHeader {
  name: string;
  description?: string;
  isSecret: boolean;
}

export interface DirectoryEntry {
  /** The registry's reverse-DNS id, e.g. "io.github.upstash/context7" - stable, used as a React key. */
  id: string;
  title: string;
  description: string;
  url: string;
  publisher: Publisher;
  /** True when the remote declares a header a person has to supply - a plain key, not OAuth. */
  needsKey: boolean;
  version?: string;
  websiteUrl?: string;
  repositoryUrl?: string;
  updatedAt?: string;
  status?: string;
  headers: DeclaredHeader[];
}

/**
 * "io.github.name/x" is a GitHub account; "com.notion/mcp" is the domain notion.com (reverse-DNS,
 * reversed).
 */
export function publisherFrom(name: string): Publisher {
  const namespace = name.split("/")[0] ?? name;
  if (namespace.startsWith("io.github.")) {
    return { kind: "github", label: `github.com/${namespace.slice("io.github.".length)}` };
  }
  return { kind: "domain", label: namespace.split(".").reverse().join(".") };
}

function toDirectoryEntry({ server, _meta }: RegistryRow): DirectoryEntry | null {
  const official = _meta?.["io.modelcontextprotocol.registry/official"];
  if (official?.status === "deleted") return null;

  const remote = (server.remotes ?? []).find((candidate) => candidate.type === "streamable-http");
  if (remote === undefined || remote.url.includes("{")) return null;

  const declared = remote.headers ?? [];
  return {
    id: server.name,
    title: server.title !== undefined && server.title !== "" ? server.title : server.name.split("/").pop() ?? server.name,
    description: server.description,
    url: remote.url,
    publisher: publisherFrom(server.name),
    needsKey: declared.some((header) => header.isRequired === true),
    version: server.version,
    websiteUrl: server.websiteUrl,
    repositoryUrl: server.repository?.url,
    updatedAt: official?.updatedAt,
    status: official?.status,
    headers: declared.map((header) => ({
      name: header.name,
      description: header.description,
      isSecret: header.isSecret === true,
    })),
  };
}

export type DirectorySearchResult =
  | { ok: true; entries: DirectoryEntry[] }
  | { ok: false };

/**
 * Pure: takes `fetchFn` as a parameter. The registry needs no proxy (CORS-open), so callers can
 * pass plain `fetch`.
 */
export async function searchMcpRegistry(query: string, fetchFn: typeof fetch): Promise<DirectorySearchResult> {
  const url = new URL(`${REGISTRY_BASE}/servers`);
  url.searchParams.set("limit", "30");
  url.searchParams.set("version", "latest");
  if (query.trim() !== "") url.searchParams.set("search", query.trim());

  let response: Response;
  try {
    response = await fetchFn(url.toString(), { headers: { accept: "application/json" } });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };

  const body = (await response.json()) as RegistrySearchResponse;
  const entries: DirectoryEntry[] = [];
  for (const row of body.servers ?? []) {
    const entry = toDirectoryEntry(row);
    if (entry !== null) entries.push(entry);
  }
  return { ok: true, entries };
}

/**
 * One server by exact registry name, used to refill entries stored by older versions that lack
 * newer fields. The registry has no by-name endpoint, so this searches and matches the id.
 */
export async function fetchServerDetail(id: string, fetchFn: typeof fetch): Promise<DirectoryEntry | null> {
  const result = await searchMcpRegistry(id, fetchFn);
  if (!result.ok) return null;
  return result.entries.find((entry) => entry.id === id) ?? null;
}

/** Directory entries connected before, so Connect Tools opens with them; kept in this browser only. */

const RECENT_KEY = "afm.mcp-recent.v1";
const MAX_RECENT = 5;

/**
 * Rows stored before `publisher` became an object, or before headers were kept, are repaired on
 * read: the id rebuilds the publisher and a missing headers list means none.
 */
function repaired(entry: DirectoryEntry): DirectoryEntry {
  const publisher: unknown = entry.publisher;
  return {
    ...entry,
    publisher:
      typeof publisher === "object" && publisher !== null ? entry.publisher : publisherFrom(entry.id),
    headers: Array.isArray(entry.headers) ? entry.headers : [],
  };
}

export function loadRecentServers(): DirectoryEntry[] {
  try {
    return loadJsonArray<DirectoryEntry>(RECENT_KEY).map(repaired);
  } catch {
    return [];
  }
}

export function recordRecentServer(entry: DirectoryEntry): void {
  const withoutThisOne = loadRecentServers().filter((existing) => existing.id !== entry.id);
  saveJson(RECENT_KEY, [entry, ...withoutThisOne].slice(0, MAX_RECENT));
}

export interface DiscoveredMcpAuth {
  authorizeUrl: string;
  tokenUrl: string;
  /** Empty when nothing could obtain one automatically; a person pastes their own. */
  clientId: string;
  scopes?: string[];
}

/**
 * Finds out whether an MCP server needs sign-in and resolves what is needed to start it: where to
 * send the user and a client_id (a Client ID Metadata Document, falling back to Dynamic Client
 * Registration). Pure: browser values are parameters. Returns `null` when no auth is needed or
 * discovery cannot tell; the caller connects without credentials.
 */
export async function resolveMcpServerAuth(
  serverUrl: string,
  fetchFn: typeof fetch,
  cimdClientId: string | undefined,
  redirectUri: string,
): Promise<DiscoveredMcpAuth | null> {
  const resource = await discoverProtectedResource(serverUrl, fetchFn);

  if (resource !== null) {
    const issuer = resource.metadata.authorization_servers[0];
    if (issuer === undefined) return null;
    const asMetadata = await discoverAuthorizationServer(issuer, fetchFn);
    if (asMetadata === null) return null;
    const scopes = resource.challengeScope ?? resource.metadata.scopes_supported;
    return resolveClientId(asMetadata, scopes, cimdClientId, redirectUri, fetchFn);
  }

  // No Protected Resource Metadata (RFC 9728): some servers act as their own authorization server,
  // identified by their origin (mcp.atlassian.com serves valid RFC 8414 metadata at its root). A
  // server needing no auth fails this fallback too, and this still returns null.
  const asMetadata = await discoverAuthorizationServer(new URL(serverUrl).origin, fetchFn);
  if (asMetadata === null) return null;
  return resolveClientId(asMetadata, asMetadata.scopes_supported, cimdClientId, redirectUri, fetchFn);
}

// Order of preference from the spec: a Client ID Metadata Document, then Dynamic Client
// Registration; with neither, the client_id stays empty for a person to paste.
async function resolveClientId(
  asMetadata: AuthorizationServerMetadata,
  scopes: string[] | undefined,
  cimdClientId: string | undefined,
  redirectUri: string,
  fetchFn: typeof fetch,
): Promise<DiscoveredMcpAuth> {
  const base = { authorizeUrl: asMetadata.authorization_endpoint, tokenUrl: asMetadata.token_endpoint, scopes };

  if (cimdClientId !== undefined && asMetadata.client_id_metadata_document_supported === true) {
    return { ...base, clientId: cimdClientId };
  }
  if (asMetadata.registration_endpoint !== undefined && asMetadata.registration_endpoint !== "") {
    try {
      const registered = await registerClient(asMetadata.registration_endpoint, [redirectUri], fetchFn);
      return { ...base, clientId: registered.clientId };
    } catch {
      // Registration failed: still return what was learned, so the person fills in only client_id.
    }
  }
  return { ...base, clientId: "" };
}

export function discoverMcpServerAuth(serverUrl: string): Promise<DiscoveredMcpAuth | null> {
  // The document AFM hosts (the spec's preferred registration), built with the site; without one
  // the client registers itself.
  const cimdClientId = import.meta.env.VITE_OAUTH_CLIENT_ID_URL || undefined;
  return resolveMcpServerAuth(serverUrl, proxyAwareFetch(), cimdClientId, `${window.location.origin}/`);
}
