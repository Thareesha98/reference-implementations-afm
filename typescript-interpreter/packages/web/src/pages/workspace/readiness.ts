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

import { authorizationCodeRefreshKey, isInteractiveOAuth, oauthProviderFrom } from "@afm/adapter-auth";
import { scanSecretUsage } from "@afm/engine";
import type { AgentMetadata } from "@afm/engine";
import type { AfmIssue } from "../../agent-validation";

export type ReadyFix = "model" | "tools" | "settings" | "raw";

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
  steps: SetupStep[];
  status: string;
  brokenServerIds: string[];
  serverNameByUrl: Map<string, string>;
  /**
   * URLs a probe heard tools back from this session. setupPlan() only knows the file uses oauth2,
   * not whether sign-in already happened, so a connected server is not asked for again.
   */
  connectedUrls: ReadonlySet<string>;
}

function toolCount(metadata: AgentMetadata | null): number | null {
  const servers = metadata?.tools?.mcp ?? [];
  if (servers.length === 0) return 0;
  let total = 0;
  for (const server of servers) {
    const allowed = server.tool_filter?.allow;
    // One server without a chosen tool list makes the count a guess, so no number is offered.
    if (allowed === undefined) return null;
    total += allowed.length;
  }
  return total;
}

/**
 * One sentence saying whether the agent can run and, if not, what is missing.
 *
 * It replaces a "Valid" chip: a file can be valid and still not run. Only the first blocker is
 * named; the second usually goes away once the first is fixed.
 */
export function readiness(input: ReadinessInput): Readiness {
  const { role, instructions, metadata, issues, steps, status, brokenServerIds, serverNameByUrl, connectedUrls } = input;

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

  // A missing role is the commonest problem and the validator words it worst, and it is fixed on
  // the canvas, so there is nothing to link to.
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

  // In order, so an already satisfied "signin" falls through to the next step in the plan rather
  // than to the final "Ready" line.
  for (const step of steps) {
    if (step.id === "key") return { tone: "ok", lead: "Ready - will ask for your key" };
    if (step.id === "signin") {
      const server = (metadata.tools?.mcp ?? []).find(
        (candidate) =>
          candidate.transport.type === "http" &&
          isInteractiveOAuth(candidate.transport.authentication) &&
          !connectedUrls.has(candidate.transport.url),
      );
      if (server === undefined) continue;
      return {
        tone: "warn",
        lead: "",
        subject: server.name,
        tail: " needs you to sign in",
        fix: "tools",
      };
    }
    return { tone: "ok", lead: "Ready - will ask which tools to allow" };
  }

  const tools = toolCount(metadata);
  if (tools === null || tools === 0) return { tone: "ok", lead: "Ready" };
  return { tone: "ok", lead: "Ready - ", subject: `${tools} tool${tools === 1 ? "" : "s"}` };
}

/**
 * Servers that count as connected: one a probe heard tools back from this load, or one with a saved
 * OAuth session, which survives a refresh. A stale one surfaces on the next real call.
 */
export function connectedServerUrls(
  metadata: AgentMetadata | null,
  probedUrls: string[],
  savedSecrets: string[],
): Set<string> {
  const connected = new Set(probedUrls);
  const saved = new Set(savedSecrets);
  for (const server of metadata?.tools?.mcp ?? []) {
    if (server.transport.type !== "http" || connected.has(server.transport.url)) continue;
    const auth = server.transport.authentication;
    if (
      auth !== undefined &&
      isInteractiveOAuth(auth) &&
      saved.has(authorizationCodeRefreshKey(oauthProviderFrom(auth, server.transport.url)))
    ) {
      connected.add(server.transport.url);
    }
  }
  return connected;
}

export type SetupStepId = "key" | "signin" | "tools";

export interface SetupStep {
  id: SetupStepId;
  label: string;
}

const LABELS: Record<SetupStepId, string> = {
  key: "Key",
  signin: "Sign in",
  tools: "Tools",
};

/**
 * What this agent will ask for before it can run, worked out from the file rather than from what is
 * pending now. Knowing the whole list up front lets the progress line say where you are; satisfied
 * steps are left out.
 */
export function setupPlan(content: string, metadata: AgentMetadata | null, savedSecrets: string[]): SetupStep[] {
  const steps: SetupStepId[] = [];

  const saved = new Set(savedSecrets);
  if (scanSecretUsage(content).some((usage) => !saved.has(usage.name))) {
    steps.push("key");
  }

  let needsSignIn = false;
  let needsToolChoice = false;
  for (const server of metadata?.tools?.mcp ?? []) {
    if (server.transport.type !== "http") continue;
    if (isInteractiveOAuth(server.transport.authentication)) needsSignIn = true;
    if (server.tool_filter === undefined) needsToolChoice = true;
  }
  // A token lives in the worker's vault, not the file, so the file can only say signing in is part
  // of this agent. Listing it either way keeps the step count steady.
  if (needsSignIn) steps.push("signin");
  if (needsToolChoice) steps.push("tools");

  return steps.map((id) => ({ id, label: LABELS[id] }));
}

type McpServers = NonNullable<NonNullable<AgentMetadata["tools"]>["mcp"]>;

/**
 * An MCP client knows a server by URL and the agent file by name. Tool descriptors carry the URL
 * and `tool_filter` is written under the name, so turning a tool selection into a file edit joins
 * the two.
 */
export function serverNameByUrl(servers: McpServers): Map<string, string> {
  const byUrl = new Map<string, string>();
  for (const server of servers) {
    if (server.transport.type !== "http") continue;
    byUrl.set(server.transport.url, server.name);
  }
  return byUrl;
}

/**
 * URLs of servers the user still has to choose tools for: they answered with a tool list and the
 * choice was not made, or was made for an agent this one only copies.
 *
 * Only servers that answered count: one that failed contributes no tools, so asking would loop
 * forever.
 */
export function serversAwaitingToolChoice(
  servers: McpServers,
  reportedToolServerIds: (string | undefined)[],
  isGranted: (serverUrl: string) => boolean = () => true,
): string[] {
  const reported = new Set(reportedToolServerIds.filter((id): id is string => id !== undefined));
  const awaiting: string[] = [];
  for (const server of servers) {
    if (server.transport.type !== "http") continue;
    if (!reported.has(server.transport.url)) continue;
    // Decided means both halves: the file says which tools, and this browser holds the grant that
    // stops every call asking. Copying an agent or opening a shared one gives the first without the
    // second, so it must ask once for the list. That also keeps a stranger's file from allowing
    // itself. An empty allow-list counts as decided: there is nothing for a grant to cover.
    if (server.tool_filter !== undefined && (server.tool_filter.allow?.length === 0 || isGranted(server.transport.url))) {
      continue;
    }
    awaiting.push(server.transport.url);
  }
  return awaiting;
}
