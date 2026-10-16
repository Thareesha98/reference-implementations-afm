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

import { compositeToolPort, mcpToolPort, mcpAuthHeaders, isDynamicAuthType, createDynamicMcpAuthHeaderProvider, filteredToolPort, effectiveUrl, namespacedToolPort } from "@afm/adapter-tool";
import type { McpDynamicAuthDeps } from "@afm/adapter-tool";
import { isInteractiveOAuth, oauthProviderFrom } from "@afm/adapter-auth";
import type { AgentMetadata, ToolPort } from "@afm/engine";
import { proxySessionFetch, requestUrl } from "./proxy-session";
import { MAX_AGENT_FILE_BYTES, limitBodies, limitResponses } from "./response-limit";

interface McpProxyConfig {
  url: string;
}

function proxyFetch(proxy: McpProxyConfig): typeof fetch {
  return limitResponses(proxySessionFetch(proxy.url));
}

export function createProxiedFetch(proxy: McpProxyConfig, maxBytes?: number): typeof fetch {
  const send = limitBodies(proxySessionFetch(proxy.url), maxBytes);
  return (input, init) => send(effectiveUrl({ serverUrl: requestUrl(input), proxyUrl: proxy.url }), init);
}

const BUILD_TIME_PROXY_URL = import.meta.env.VITE_MCP_PROXY_URL;

export const defaultMcpProxyConfig: McpProxyConfig | null =
  BUILD_TIME_PROXY_URL !== undefined && BUILD_TIME_PROXY_URL !== "" ? { url: BUILD_TIME_PROXY_URL } : null;

export function proxyAwareFetch(): typeof fetch {
  return defaultMcpProxyConfig !== null ? createProxiedFetch(defaultMcpProxyConfig) : fetch;
}

export function agentFileFetch(): typeof fetch {
  const proxy = defaultMcpProxyConfig;
  return proxy === null ? () => Promise.reject(new McpProxyRequiredError()) : createProxiedFetch(proxy, MAX_AGENT_FILE_BYTES);
}

export class McpProxyRequiredError extends Error {
  constructor() {
    super(
      "No MCP proxy is configured. AFM does not connect to external servers directly from the " +
        "browser - set an MCP proxy (VITE_MCP_PROXY_URL) before connecting tools.",
    );
    this.name = "McpProxyRequiredError";
  }
}

export interface ToolSetupOptions {
  setupTimeoutMs?: number;
}

type McpServer = NonNullable<NonNullable<AgentMetadata["tools"]>["mcp"]>[number];

export function mcpServerPort(
  server: McpServer,
  proxy: McpProxyConfig | null,
  authDeps: McpDynamicAuthDeps = {},
  { setupTimeoutMs }: ToolSetupOptions = {},
): ToolPort | null {
  const { transport } = server;
  if (transport.type !== "http") return null;
  if (proxy === null) throw new McpProxyRequiredError();

  const effectiveAuthDeps: McpDynamicAuthDeps = {
    ...authDeps,
    fetchFn: authDeps.fetchFn ?? createProxiedFetch(proxy),
  };
  const auth = transport.authentication;
  const dynamic = auth !== undefined && isDynamicAuthType(auth);
  let port: ToolPort = mcpToolPort({
    serverUrl: transport.url,
    headers: auth !== undefined && !dynamic ? mcpAuthHeaders(auth) : undefined,
    authHeaderProvider: dynamic ? createDynamicMcpAuthHeaderProvider(auth, effectiveAuthDeps, transport.url) : undefined,
    onAuthRejected:
      dynamic && isInteractiveOAuth(auth)
        ? () => effectiveAuthDeps.onInteractiveAuthRejected?.(oauthProviderFrom(auth, transport.url))
        : undefined,
    proxyUrl: proxy.url,
    fetchFn: proxyFetch(proxy),
    setupTimeoutMs,
  });
  if (server.tool_filter !== undefined) {
    port = filteredToolPort(port, server.tool_filter);
  }
  return port;
}

export function toolsFromMetadata(
  metadata: AgentMetadata,
  proxy: McpProxyConfig | null,
  authDeps: McpDynamicAuthDeps = {},
  options: ToolSetupOptions = {},
): ToolPort {
  const servers = metadata.tools?.mcp ?? [];
  return compositeToolPort(
    servers.flatMap((server) => {
      const port = mcpServerPort(server, proxy, authDeps, options);
      return port === null ? [] : [namespacedToolPort(port, server.name)];
    }),
  );
}
