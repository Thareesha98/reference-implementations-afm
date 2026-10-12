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


export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  client_id_metadata_document_supported?: boolean;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

async function tryFetchJson<T>(url: string, fetchFn: typeof fetch): Promise<T | null> {
  try {
    const response = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function parseResourceMetadataUrl(wwwAuthenticate: string): string | null {
  const match = /resource_metadata="([^"]+)"/.exec(wwwAuthenticate);
  return match?.[1] ?? null;
}

export function parseChallengeScope(wwwAuthenticate: string): string[] | null {
  const match = /(?:^|,)\s*scope="([^"]*)"/.exec(wwwAuthenticate);
  if (match?.[1] === undefined || match[1].trim() === "") return null;
  return match[1].split(/\s+/);
}

function wellKnownProtectedResourceCandidates(serverUrl: string): string[] {
  const { origin, pathname } = new URL(serverUrl);
  const path = pathname === "/" ? "" : pathname;
  return path === "" ? [`${origin}/.well-known/oauth-protected-resource`] : [`${origin}/.well-known/oauth-protected-resource${path}`, `${origin}/.well-known/oauth-protected-resource`];
}

export interface ProtectedResourceDiscovery {
  metadata: ProtectedResourceMetadata;
  challengeScope: string[] | null;
}

export async function discoverProtectedResource(serverUrl: string, fetchFn: typeof fetch): Promise<ProtectedResourceDiscovery | null> {
  let probe: Response;
  try {
    probe = await fetchFn(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }),
    });
  } catch {
    return null;
  }
  if (probe.status !== 401) return null;

  const challenge = probe.headers.get("www-authenticate");
  const challengeScope = challenge !== null ? parseChallengeScope(challenge) : null;
  const fromHeader = challenge !== null ? parseResourceMetadataUrl(challenge) : null;
  const candidates = fromHeader !== null ? [fromHeader] : wellKnownProtectedResourceCandidates(serverUrl);

  for (const candidate of candidates) {
    const metadata = await tryFetchJson<ProtectedResourceMetadata>(candidate, fetchFn);
    if (metadata !== null && Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0) {
      return { metadata, challengeScope };
    }
  }
  return null;
}

function authorizationServerCandidates(issuerUrl: string): string[] {
  const { origin, pathname } = new URL(issuerUrl);
  const path = pathname === "/" ? "" : pathname.replace(/\/$/, "");
  if (path === "") {
    return [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`];
  }
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${origin}${path}/.well-known/openid-configuration`,
  ];
}

export async function discoverAuthorizationServer(issuerUrl: string, fetchFn: typeof fetch): Promise<AuthorizationServerMetadata | null> {
  for (const candidate of authorizationServerCandidates(issuerUrl)) {
    const metadata = await tryFetchJson<AuthorizationServerMetadata>(candidate, fetchFn);
    if (
      metadata !== null &&
      metadata.issuer === issuerUrl &&
      Array.isArray(metadata.code_challenge_methods_supported) &&
      metadata.code_challenge_methods_supported.includes("S256")
    ) {
      return metadata;
    }
  }
  return null;
}

export async function registerClient(
  registrationEndpoint: string,
  redirectUris: string[],
  fetchFn: typeof fetch,
): Promise<{ clientId: string }> {
  const isLocal = redirectUris.some((uri) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(uri));
  const response = await fetchFn(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "AFM",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: isLocal ? "native" : "web",
    }),
  });
  if (!response.ok) {
    throw new Error(`Dynamic Client Registration failed: ${response.status}`);
  }
  const body = (await response.json()) as { client_id?: unknown };
  if (typeof body.client_id !== "string" || body.client_id === "") {
    throw new Error("Dynamic Client Registration response had no client_id");
  }
  return { clientId: body.client_id };
}
