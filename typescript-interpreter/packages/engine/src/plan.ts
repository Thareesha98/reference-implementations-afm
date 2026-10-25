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

import type { AgentMetadata } from "./schema";

export type PlanSeverity = "warning" | "blocked";

export interface PlanIssue {
  severity: PlanSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface Plan {
  runnable: boolean;
  issues: PlanIssue[];
}

function plainStringSignature(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null &&
    Object.keys(schema).length === 1 && "type" in schema && schema.type === "string";
}

export function planForBrowser(metadata: AgentMetadata): Plan {
  const issues: PlanIssue[] = [];

  (metadata.interfaces ?? []).forEach((iface, i) => {
    if (iface.type !== "webchat") {
      issues.push({
        severity: "warning",
        code: "interface-unsupported",
        message: `The '${iface.type}' interface does not run in this browser. You can try the agent in web chat instead.`,
        path: `interfaces[${i}]`,
      });
    } else if (!plainStringSignature(iface.signature.input) || !plainStringSignature(iface.signature.output)) {
      issues.push({
        severity: "warning",
        code: "structured-signature-unsupported",
        message: "This webchat defines structured input or output. This browser chat accepts and returns text.",
        path: `interfaces[${i}].signature`,
      });
    }
  });

  if (metadata.model?.url !== undefined) {
    issues.push({
      severity: "warning",
      code: "model-url-unsupported",
      message: "This browser cannot use the custom model URL. It can use the provider's default endpoint instead.",
      path: "model.url",
    });
  }

  if (metadata.model?.provider !== undefined && !["openai", "anthropic"].includes(metadata.model.provider.toLowerCase())) {
    issues.push({
      severity: "blocked",
      code: "model-provider-unsupported",
      message: `Model provider '${metadata.model.provider}' is valid AFM but is not supported by this browser. Choose OpenAI or Anthropic to run here.`,
      path: "model.provider",
    });
  }

  const modelAuth = metadata.model?.authentication;
  const modelAuthType = modelAuth?.type.toLowerCase();
  if (modelAuthType !== undefined && modelAuthType !== "api-key" && modelAuthType !== "bearer") {
    issues.push({
      severity: "blocked",
      code: "model-auth-unsupported",
        message: `The model's '${modelAuthType}' authentication does not run in this browser; use an API key or bearer token.`,
      path: "model.authentication",
    });
  }

  (metadata.tools?.mcp ?? []).forEach((server, i) => {
    if (server.transport.type === "stdio") {
      issues.push({
        severity: "warning",
        code: "stdio-transport-unsupported",
        message: `MCP server '${server.name}' uses stdio, which a browser cannot run; it will be skipped. Only HTTP MCP works (via the proxy).`,
        path: `tools.mcp[${i}].transport`,
      });
    } else if (server.transport.authentication?.type.toLowerCase() === "jwt") {
      issues.push({
        severity: "blocked",
        code: "jwt-auth-unsupported",
        message: `MCP server '${server.name}' uses jwt authentication, which needs a server-side runtime. In a browser, use oauth2 sign-in or a bearer access token.`,
        path: `tools.mcp[${i}].transport.authentication`,
      });
    } else if (server.transport.authentication !== undefined &&
      !["bearer", "basic", "api-key", "oauth2"].includes(server.transport.authentication.type.toLowerCase())) {
      issues.push({
        severity: "blocked",
        code: "tool-auth-unsupported",
        message: `MCP server '${server.name}' uses ${server.transport.authentication.type} authentication, which this browser cannot use. Configure a supported authentication method.`,
        path: `tools.mcp[${i}].transport.authentication`,
      });
    }
  });

  (metadata.skills ?? []).forEach((_, i) => {
    issues.push({
      severity: "warning",
      code: "local-skill-unsupported",
      message: "This browser cannot read a local skill directory. The skill will be skipped.",
      path: `skills[${i}]`,
    });
  });

  const runnable = !issues.some((issue) => issue.severity === "blocked");
  return { runnable, issues };
}

function mapping(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function browserRunMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const model = mapping(metadata.model);
  const tools = mapping(metadata.tools);
  const servers = Array.isArray(tools?.mcp) ? tools.mcp.filter((item) => {
    const server = mapping(item);
    return mapping(server?.transport)?.type === "http";
  }) : tools?.mcp;
  return {
    ...metadata,
    model: model === null ? metadata.model : { ...model, url: undefined },
    interfaces: Array.isArray(metadata.interfaces) ? metadata.interfaces.flatMap((item) => {
      const iface = mapping(item);
      return iface?.type === "webchat"
        ? [{ ...iface, signature: { input: { type: "string" }, output: { type: "string" } } }]
        : [];
    }) : metadata.interfaces,
    tools: tools === null ? metadata.tools : {
      ...tools,
      mcp: servers,
    },
    skills: undefined,
  };
}
