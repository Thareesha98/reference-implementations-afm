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

import type { AgentMetadata } from "@afm/engine";
import type { AfmIssue } from "../../agent-validation";

export type ReadyFix = "model" | "tools" | "settings" | "raw" | "chat";

export interface Readiness {
  tone: "ok" | "warn" | "bad";
  lead: string;
  subject?: string;
  tail?: string;
  fix?: ReadyFix;
}

export interface ReadinessInput {
  role: string;
  instructions: string;
  metadata: AgentMetadata | null;
  issues: AfmIssue[];
  status: string;
  current: boolean;
  failed: boolean;
  brokenServerIds: string[];
  serverNameByUrl: Map<string, string>;
}

export function readiness(input: ReadinessInput): Readiness {
  const { role, instructions, metadata, issues, status, current, failed, brokenServerIds, serverNameByUrl } = input;

  if (status === "streaming" || status === "connecting") {
    const broken = brokenServerIds[0];
    if (broken !== undefined) {
      return {
        tone: "bad",
        lead: "Running - ",
        subject: `${serverNameByUrl.get(broken) ?? broken} did not answer`,
        fix: "tools",
      };
    }
    return { tone: "ok", lead: "Running - waiting on the model" };
  }

  if (metadata === null) {
    return { tone: "bad", lead: "The settings at the top of the file can’t be read - ", subject: "open the file", fix: "raw" };
  }

  if ((metadata.model?.name ?? "") === "") {
    return { tone: "bad", lead: "Needs a model before it can run - ", subject: "choose one", fix: "model" };
  }

  if (role.trim() === "") {
    return { tone: "bad", lead: "Needs a role before it can run" };
  }

  if (instructions.trim() === "") {
    return { tone: "bad", lead: "Needs instructions before it can run" };
  }

  const firstError = issues.find((issue) => issue.severity === "error");
  if (firstError !== undefined) {
    return { tone: "bad", lead: "Has a problem - ", subject: firstError.message, fix: "raw" };
  }

  if (failed) {
    return { tone: "bad", lead: "Did not start - ", subject: "see why", fix: "chat" };
  }

  return { tone: "ok", lead: current && status === "ready" ? "Running" : "Ready" };
}

type McpServers = NonNullable<NonNullable<AgentMetadata["tools"]>["mcp"]>;

export function serverNameByUrl(servers: McpServers): Map<string, string> {
  const byUrl = new Map<string, string>();
  for (const server of servers) {
    if (server.transport.type !== "http") continue;
    byUrl.set(server.transport.url, server.name);
  }
  return byUrl;
}
