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

import { compositeToolPort, mcpToolPort, mcpAuthHeaders, isDynamicAuthType, createDynamicMcpAuthHeaderProvider, filteredToolPort, effectiveUrl } from "@afm/adapter-tool";
import type { McpDynamicAuthDeps } from "@afm/adapter-tool";
import { isInteractiveOAuth, oauthProviderFrom } from "@afm/adapter-auth";
import type { AgentMetadata, ToolPort } from "@afm/engine";

interface McpProxyConfig {
  url: string;
}

export function createProxiedFetch(proxy: McpProxyConfig): typeof fetch {
  return (input, init) => {
    const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return fetch(effectiveUrl({ serverUrl: targetUrl, proxyUrl: proxy.url }), init);
  };
}

const BUILD_TIME_PROXY_URL = import.meta.env.VITE_MCP_PROXY_URL;

export const defaultMcpProxyConfig: McpProxyConfig | null =
  BUILD_TIME_PROXY_URL !== undefined && BUILD_TIME_PROXY_URL !== "" ? { url: BUILD_TIME_PROXY_URL } : null;

// Most MCP and authorization servers send no CORS headers for this origin, so MCP-adjacent requests
// go through the proxy when one is configured, and directly otherwise.
export function proxyAwareFetch(): typeof fetch {
  return defaultMcpProxyConfig !== null ? createProxiedFetch(defaultMcpProxyConfig) : fetch;
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

export type ServerProgress = (name: string, state: "active" | "done" | "failed", note?: string) => void;

// Connecting is lazy (first list()). Wrapping each server lets the loading screen tick them off and
// name the one that failed.
function reportingToolPort(port: ToolPort, name: string, report: ServerProgress): ToolPort {
  let announced = false;
  return {
    ...port,
    async list() {
      if (!announced) {
        announced = true;
        report(name, "active");
      }
      try {
        const descriptors = await port.list();
        report(name, "done");
        return descriptors;
      } catch (error) {
        report(name, "failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    execute: (call, signal) => port.execute(call, signal),
    dispose: port.dispose === undefined ? undefined : () => port.dispose!(),
  };
}

export interface ToolSetupOptions {
  onServerProgress?: ServerProgress;
  /** Passed to every server. The Add-a-server panel uses a shorter one, since someone is watching. */
  setupTimeoutMs?: number;
}

export function toolsFromMetadata(
  metadata: AgentMetadata,
  proxy: McpProxyConfig | null,
  authDeps: McpDynamicAuthDeps = {},
  { onServerProgress, setupTimeoutMs }: ToolSetupOptions = {},
): ToolPort {
  const servers = metadata.tools?.mcp ?? [];

  if (servers.some((server) => server.transport.type === "http") && proxy === null) {
    throw new McpProxyRequiredError();
  }

  const effectiveAuthDeps: McpDynamicAuthDeps = {
    ...authDeps,
    fetchFn: authDeps.fetchFn ?? (proxy !== null ? createProxiedFetch(proxy) : undefined),
  };

  const ports = servers.flatMap((server): ToolPort[] => {
    const { transport } = server;
    if (transport.type !== "http") return [];
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
      proxyUrl: proxy?.url,
      setupTimeoutMs,
    });
    if (server.tool_filter !== undefined) {
      port = filteredToolPort(port, server.tool_filter);
    }
    if (onServerProgress !== undefined) {
      port = reportingToolPort(port, server.name, onServerProgress);
    }
    return [port];
  });
  return compositeToolPort(ports);
}
