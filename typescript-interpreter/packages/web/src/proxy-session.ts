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

const SESSION_HEADER = "X-Choreo-Correlation-Id";
const SESSION_ID_PREFIX = "afm-";
const SESSION_ID_MAX_LENGTH = 64;

let proxySessionId: string | null = null;

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/**
 * Sends the session id the MCP proxy handed out on every request to the proxy, and keeps the newest
 * one it hands back. The proxy rate-limits per id; it is a bucket label, not the MCP protocol's own
 * Mcp-Session-Id. The id lives in memory only and never goes to any other origin. The page and the
 * worker are separate contexts, so each keeps its own id and gets its own bucket from the proxy.
 */
export function proxySessionFetch(proxyUrl: string, baseFetch?: typeof fetch): typeof fetch {
  const proxyOrigin = new URL(proxyUrl).origin;
  return async (input, init) => {
    const send = baseFetch ?? fetch;
    if (new URL(requestUrl(input)).origin !== proxyOrigin) return send(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (proxySessionId !== null) headers.set(SESSION_HEADER, proxySessionId);
    const response = await send(input, { ...init, headers });

    const issued = response.headers.get(SESSION_HEADER);
    if (issued !== null && issued.startsWith(SESSION_ID_PREFIX) && issued.length <= SESSION_ID_MAX_LENGTH) {
      proxySessionId = issued;
    }
    return response;
  };
}
