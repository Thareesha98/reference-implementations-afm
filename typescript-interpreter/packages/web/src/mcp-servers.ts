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
import { DIRECTORY_ENTRIES } from "./mcp-directory";
import type { DirectoryEntry, OAuthSignIn } from "./mcp-directory";

function searchText(entry: DirectoryEntry): string {
  return `${entry.title} ${entry.description} ${entry.publisher}`.toLowerCase();
}

export function searchDirectory(query: string, entries: readonly DirectoryEntry[] = DIRECTORY_ENTRIES): DirectoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== "");
  const inTitle = (entry: DirectoryEntry) => terms.every((term) => entry.title.toLowerCase().includes(term));
  return entries
    .filter((entry) => terms.every((term) => searchText(entry).includes(term)))
    .sort((a, b) => Number(inTitle(b)) - Number(inTitle(a)) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
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
  asMetadata: Pick<
    AuthorizationServerMetadata,
    "authorization_endpoint" | "token_endpoint" | "registration_endpoint" | "client_id_metadata_document_supported"
  >,
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

/**
 * Everything a directory entry already says about its sign-in is used as written; only the client_id
 * is left to resolve, the same way as for a server found by address. Pure: browser values are
 * parameters.
 */
export function resolveDirectoryAuth(
  auth: OAuthSignIn,
  fetchFn: typeof fetch,
  cimdClientId: string | undefined,
  redirectUri: string,
): Promise<DiscoveredMcpAuth> {
  const endpoints = {
    authorization_endpoint: auth.authorizeUrl,
    token_endpoint: auth.tokenUrl,
    registration_endpoint: auth.registrationUrl,
    client_id_metadata_document_supported: auth.clientIdMetadata,
  };
  return resolveClientId(endpoints, auth.scopes, cimdClientId, redirectUri, fetchFn);
}

function browserClient(): { cimdClientId: string | undefined; redirectUri: string } {
  // The document AFM hosts (the spec's preferred registration), built with the site; without one
  // the client registers itself.
  return {
    cimdClientId: import.meta.env.VITE_OAUTH_CLIENT_ID_URL || undefined,
    redirectUri: `${window.location.origin}/`,
  };
}

export function discoverMcpServerAuth(serverUrl: string): Promise<DiscoveredMcpAuth | null> {
  const { cimdClientId, redirectUri } = browserClient();
  return resolveMcpServerAuth(serverUrl, proxyAwareFetch(), cimdClientId, redirectUri);
}

export function resolveDirectoryClient(auth: OAuthSignIn): Promise<DiscoveredMcpAuth> {
  const { cimdClientId, redirectUri } = browserClient();
  return resolveDirectoryAuth(auth, proxyAwareFetch(), cimdClientId, redirectUri);
}
