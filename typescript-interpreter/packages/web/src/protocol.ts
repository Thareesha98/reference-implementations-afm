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

import type { OAuthProviderRef } from "@afm/adapter-auth";
import type { Plan, LoopEvent, AgentMetadata, ChatMessage } from "@afm/engine";

export type AgentModelRef = AgentMetadata["model"];

/** Taken from the loop's own finish event, so the two cannot drift. */
export type TurnEndReason = Extract<LoopEvent, { type: "finish" }>["reason"];

export interface ImageAttachment {
  name: string;
  mediaType: string;
  data: string;
}

export type ClientMessage =
  | {
      type: "load";
      content: string;
      seedHistory?: ChatMessage[];
      permissionSeed?: string[];
      loadId: string;
    }
  | { type: "send"; text: string; images?: ImageAttachment[] }
  | { type: "attach-files"; files: { name: string; path: string; text: string; pages?: number }[] }
  | { type: "detach-file"; path: string }
  | { type: "cancel" }
  | { type: "regenerate" }
  | { type: "reset-chat" }
  | { type: "secret-response"; name: string; value: string | null }
  | { type: "set-secret"; name: string; value: string }
  // A sealed secret opened on purpose from a panel. The main thread runs the ceremony and sends the
  // derived key.
  | { type: "unlock-secret"; name: string; key: CryptoKey }
  | { type: "secret-approval-response"; name: string; approved: boolean }
  // The derived key crosses as a non-extractable CryptoKey; the plaintext secret never travels this
  // way.
  | {
      type: "passkey-remember";
      name: string;
      key: CryptoKey;
      credentialId: Uint8Array<ArrayBuffer>;
      salt: Uint8Array<ArrayBuffer>;
    }
  // Moves a sealed copy from one passkey to another inside the worker; both keys are derived on the
  // main thread and non-extractable.
  | {
      type: "passkey-reseal";
      name: string;
      from: CryptoKey;
      to: CryptoKey;
      credentialId: Uint8Array<ArrayBuffer>;
      salt: Uint8Array<ArrayBuffer>;
    }
  | { type: "passkey-unlock-response"; id: string; key: CryptoKey | null }
  | { type: "passkey-forget"; name: string }
  | { type: "list-secrets" }
  | { type: "list-passkeys" }
  | { type: "remove-secret"; name: string }
  | { type: "permission-response"; id: string; decision: "allow" | "deny"; remember: boolean }
  // Starts an interactive sign-in: the worker creates the PKCE verifier and state, so none of it
  // lives on the main thread.
  | { type: "oauth-signin-start"; id: string; provider: OAuthProviderRef }
  // The popup's one-time code. It carries no URLs: the worker exchanges against the endpoint
  // captured at oauth-signin-start.
  | { type: "oauth-signin-code"; id: string; code: string; state: string; iss?: string }
  | { type: "oauth-sign-out"; provider: OAuthProviderRef }
  | { type: "generate-draft"; prompt: string; model: AgentModelRef; final?: boolean }
  | { type: "probe-server"; id: string; server: AgentMetadata["tools"] };

export interface ToolInfo {
  name: string;
  description?: string;
  serverId?: string;
}

export interface LoadStep {
  key: string;
  label: string;
  state: "active" | "done" | "failed";
  note?: string;
}

export type ServerMessage =
  | ({ type: "load-step" } & LoadStep)
  | {
      type: "loaded";
      name: string;
      mcpServers: string[];
      plan: Plan;
    }
  | { type: "agent-ready"; toolCount: number; tools: ToolInfo[] }
  | { type: "agent-not-ready"; reason: string }
  | { type: "secrets-list"; names: string[] }
  | { type: "passkey-list"; names: string[] }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; name: string; ok: boolean; content: string }
  | { type: "turn-finished"; reason: TurnEndReason }
  | { type: "notice"; text: string }
  | { type: "secret-request"; name: string }

  | { type: "secret-approval-request"; name: string; hosts: string[] }
  // The worker holds a sealed secret it cannot open alone; only the main thread can ask the
  // authenticator.
  | {
      type: "passkey-unlock-request";
      id: string;
      name: string;
      credentialId: Uint8Array<ArrayBuffer>;
      salt: Uint8Array<ArrayBuffer>;
    }
  | { type: "permission-request"; id: string; name: string; args: unknown; serverId?: string }
  // The worker has no token for this provider and cannot open a popup itself. loadId ties it to the
  // current run.
  | { type: "oauth-signin-needed"; provider: OAuthProviderRef; loadId: string }
  | { type: "oauth-authorize-url"; id: string; url: string }
  | { type: "oauth-signin-done"; id: string; ok: boolean; error?: string }
  | {
      type: "budget-update";
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      maxTokens?: number;
      iteration: number;
      maxIterations: number;
      elapsedMs: number;
      maxWallClockMs?: number;
    }
  | { type: "draft-generated"; source: string }
  | { type: "draft-clarify"; questions: string[] }
  | { type: "draft-generation-error"; message: string }
  | { type: "probe-result"; id: string; tools?: ToolInfo[]; error?: string }
  | { type: "error"; message: string };

export function serverMessageFromLoopEvent(event: LoopEvent): ServerMessage | null {
  switch (event.type) {
    case "text-delta":
      return { type: "text-delta", text: event.text };
    case "tool-call":
      return { type: "tool-call", id: event.id, name: event.name, args: event.args };
    case "tool-result":
      return {
        type: "tool-result",
        id: event.id,
        name: event.name,
        ok: event.ok,
        content: event.content,
      };
    case "budget-update":
      return {
        type: "budget-update",
        totalTokens: event.totalTokens,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        maxTokens: event.maxTokens,
        iteration: event.iteration,
        maxIterations: event.maxIterations,
        elapsedMs: event.elapsedMs,
        maxWallClockMs: event.maxWallClockMs,
      };
    case "waiting":
      return {
        type: "notice",
        text: `Rate limited by the model provider - retrying in ${Math.round(event.delayMs / 1000)}s (attempt ${event.attempt} of ${event.ofAttempts}). ${event.reason}`,
      };
    case "finish":
      return { type: "turn-finished", reason: event.reason };
    default:
      return null;
  }
}

export function permissionKey(serverId: string | undefined, toolName: string): string {
  return `${serverId ?? "local"}::${toolName}`;
}
