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

import type { PlanIssue } from "@afm/engine";
import type { OAuthProviderRef } from "@afm/adapter-auth";
import type { ServerMessage, ToolInfo, ImageAttachment, LoadStep, TurnEndReason } from "./protocol";
import { attachedFilesOf, attachedFileKey } from "./chat/attachment";

export interface BudgetSnapshot {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  maxTokens?: number;
  iteration: number;
  maxIterations: number;
  elapsedMs: number;
  maxWallClockMs?: number;
}

export interface AttachedFile {
  name: string;
  /** Key the worker holds the file under; absent on conversations saved by older versions. */
  path?: string;
  chars?: number;
  pages?: number;
}

export type UiMessage =
  | { kind: "user"; id: number; text: string; images?: ImageAttachment[] }
  | { kind: "assistant"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      callId: string;
      name: string;
      args: unknown;
      status: "running" | "ok" | "failed";
      result?: string;
    }
  | { kind: "attachment"; id: number; files: AttachedFile[] }
  | { kind: "notice"; id: number; text: string };

export interface PendingPermission {
  id: string;
  name: string;
  args: unknown;
  serverId?: string;
}

export interface PendingPasskeyUnlock {
  id: string;
  name: string;
  credentialId: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export interface PendingOAuthSignIn {
  provider: OAuthProviderRef;
}

export type AgentStatus =
  | "no-agent"
  | "connecting"
  | "testing"
  | "ready"
  | "not-ready"
  | "streaming";

export interface ChatState {
  status: AgentStatus;
  agentName: string;
  agentSource: string;
  mcpServers: string[];
  planIssues: PlanIssue[];
  loadSteps: LoadStep[];
  toolCount: number;
  tools: ToolInfo[];
  notReady: string | null;
  messages: UiMessage[];
  savedSecrets: string[];
  passkeySecrets: string[];
  secretsLoaded: boolean;
  pendingSecret: string | null;
  pendingSecretApproval: { name: string; hosts: string[] } | null;
  pendingPasskeyUnlock: PendingPasskeyUnlock | null;
  pendingPermission: PendingPermission | null;
  pendingOAuthSignIn: PendingOAuthSignIn | null;
  error: string | null;
  nextId: number;
  budget: BudgetSnapshot | null;
  generatedDraft: string | null;
  clarifyQuestions: string[];
  draftError: string | null;
}

export const initialChatState: ChatState = {
  status: "no-agent",
  agentName: "",
  agentSource: "",
  mcpServers: [],
  planIssues: [],
  loadSteps: [],
  toolCount: 0,
  tools: [],
  notReady: null,
  messages: [],
  savedSecrets: [],
  passkeySecrets: [],
  secretsLoaded: false,
  pendingSecret: null,
  pendingSecretApproval: null,
  pendingPasskeyUnlock: null,
  pendingPermission: null,
  pendingOAuthSignIn: null,
  error: null,
  nextId: 1,
  budget: null,
  generatedDraft: null,
  clarifyQuestions: [],
  draftError: null,
};

/**
 * Keys usable without asking the user to type one: in memory now, or sealed on disk. `savedSecrets`
 * alone is memory-only, so it is empty after a reload.
 */
export function usableSecrets(state: ChatState): string[] {
  return [...new Set([...state.savedSecrets, ...state.passkeySecrets])];
}

export type ChatAction =
  | { type: "user-message"; text: string; images?: ImageAttachment[] }
  | { type: "agent-loading"; content: string; keepMessages: boolean }
  | { type: "restore-session"; messages: UiMessage[]; agentSource: string; agentName?: string }
  | { type: "draft-dismissed" }
  | { type: "agent-cleared" }
  | { type: "regenerate-start" }
  | { type: "edit-last" }
  | { type: "server"; message: ServerMessage }
  | { type: "secret-dismissed" }
  | { type: "passkey-unlock-dismissed" }
  | { type: "permission-dismissed" }
  | { type: "oauth-signin-dismissed" }
  | { type: "files-attached"; files: AttachedFile[] }
  | { type: "file-detached"; id: number; key: string }
  | { type: "viewing-different-agent" };

export function lastUserIndex(messages: UiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.kind === "user") return i;
  }
  return -1;
}

/**
 * What to tell the user about how a turn ended, or null when there is nothing to say. Only "stop"
 * is a clean ending.
 */
export function turnEndNotice(reason: TurnEndReason, maxIterations?: number): string | null {
  switch (reason) {
    case "stop":
      return null;
    case "aborted":
      return "Stopped. Any tool calls still queued were cancelled.";
    case "max-iterations": {
      // The count comes from budget-update, which a model that reports no usage never sends.
      const limit = maxIterations === undefined ? "its limit" : `${maxIterations} steps`;
      return `Stopped after ${limit} - the agent hit its iteration limit, so the answer above may be unfinished. Raise 'max_iterations' in the agent file to let it go further.`;
    }
    case "budget":
      return "Stopped at the token or time budget for this turn, so the answer above may be unfinished.";
  }
}

// Every question the user is being asked; a new start-up or a different agent makes each moot.
const NO_PENDING = {
  pendingSecret: null,
  pendingSecretApproval: null,
  pendingPasskeyUnlock: null,
  pendingPermission: null,
  pendingOAuthSignIn: null,
} as const;

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

// Appending is the one place an id is handed out, so none can be reused or skipped.
function withMessage(state: ChatState, { kind, ...rest }: WithoutId<UiMessage>): ChatState {
  return {
    ...state,
    messages: [...state.messages, { kind, id: state.nextId, ...rest } as UiMessage],
    nextId: state.nextId + 1,
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "user-message":
      return withMessage(
        { ...state, status: "streaming", error: null, budget: null },
        { kind: "user", text: action.text, images: action.images },
      );
    case "agent-loading":
      return {
        ...state,
        ...NO_PENDING,
        status: "connecting",
        agentSource: action.content,
        // A new start-up reports its own stages; the last run's would show steps as done before
        // they happen.
        loadSteps: [],
        error: null,
        notReady: null,
        messages: action.keepMessages ? state.messages : [],
      };
    case "restore-session":
      return {
        ...state,
        ...NO_PENDING,
        status: "connecting",
        agentSource: action.agentSource,
        // Known from the stored conversation, so the header is right before the worker reports the
        // agent as loaded.
        agentName: action.agentName ?? state.agentName,
        messages: action.messages,
        // Past every restored id; after a reload the next message would otherwise reuse one and two
        // messages would share a React key.
        nextId: Math.max(state.nextId, ...action.messages.map((message) => message.id + 1)),
        error: null,
        notReady: null,
      };
    case "viewing-different-agent":
      return { ...state, ...NO_PENDING };
    // The written file was accepted, rejected or requested again; either way the last answer is
    // finished with.
    case "draft-dismissed":
      return { ...state, generatedDraft: null, clarifyQuestions: [], draftError: null };
    // Switching agent or starting a blank one: everything about the agent that was running goes,
    // since none of it describes the file now open. Saved keys belong to the browser and stay.
    case "agent-cleared":
      return {
        ...initialChatState,
        savedSecrets: state.savedSecrets,
        passkeySecrets: state.passkeySecrets,
        nextId: state.nextId,
      };
    case "regenerate-start": {
      const index = lastUserIndex(state.messages);
      if (index === -1) return state;
      return { ...state, status: "streaming", error: null, messages: state.messages.slice(0, index + 1) };
    }
    case "edit-last": {
      const index = lastUserIndex(state.messages);
      if (index === -1) return state;
      return { ...state, messages: state.messages.slice(0, index) };
    }
    case "secret-dismissed":
      return { ...state, pendingSecret: null, pendingSecretApproval: null };
    case "passkey-unlock-dismissed":
      return { ...state, pendingPasskeyUnlock: null };
    case "permission-dismissed":
      return { ...state, pendingPermission: null };
    case "oauth-signin-dismissed":
      return { ...state, pendingOAuthSignIn: null };
    case "files-attached":
      return withMessage(state, { kind: "attachment", files: action.files });
    case "file-detached": {
      const messages = state.messages
        .map((message) =>
          // Rebuilt, not spread, so a row from the old name-only shape is normalised instead of
          // written back with both shapes.
          message.kind === "attachment" && message.id === action.id
            ? {
                kind: "attachment" as const,
                id: message.id,
                files: attachedFilesOf(message).filter((file) => attachedFileKey(file) !== action.key),
              }
            : message,
        )
        .filter((message) => message.kind !== "attachment" || message.files.length > 0);
      return { ...state, messages };
    }
    case "server":
      return applyServerMessage(state, action.message);
  }
}

function applyServerMessage(state: ChatState, message: ServerMessage): ChatState {
  switch (message.type) {
    case "load-step": {
      const step: LoadStep = {
        key: message.key,
        label: message.label,
        state: message.state,
        note: message.note,
      };
      const at = state.loadSteps.findIndex((existing) => existing.key === step.key);
      // Reporting the same key again is the same stage settling: replace it in place to keep the
      // start order.
      const loadSteps =
        at === -1
          ? [...state.loadSteps, step]
          : state.loadSteps.map((existing, index) => (index === at ? step : existing));
      return { ...state, loadSteps };
    }
    case "loaded":
      return {
        ...state,
        status: "testing",
        agentName: message.name,
        mcpServers: message.mcpServers,
        planIssues: message.plan.issues,
        notReady: null,
        error: null,
      };
    case "agent-ready":
      return { ...state, status: "ready", toolCount: message.toolCount, tools: message.tools, notReady: null };
    case "agent-not-ready":
      return { ...state, status: "not-ready", notReady: message.reason };
    case "secrets-list":
      return { ...state, savedSecrets: message.names, secretsLoaded: true };
    case "passkey-list":
      return { ...state, passkeySecrets: message.names };
    case "text-delta":
      return appendToAssistant(state, message.text);
    case "tool-call":
      return withMessage(state, {
        kind: "tool",
        callId: message.id,
        name: message.name,
        args: message.args,
        status: "running",
      });
    case "tool-result":
      return updateTool(state, message.id, message.ok, message.content);
    case "notice":
      return withMessage(state, { kind: "notice", text: message.text });
    case "budget-update":
      return {
        ...state,
        budget: {
          totalTokens: message.totalTokens,
          inputTokens: message.inputTokens,
          outputTokens: message.outputTokens,
          maxTokens: message.maxTokens,
          iteration: message.iteration,
          maxIterations: message.maxIterations,
          elapsedMs: message.elapsedMs,
          maxWallClockMs: message.maxWallClockMs,
        },
      };
    case "turn-finished": {
      const ready = { ...state, status: "ready" as const, pendingPermission: null };
      const text = turnEndNotice(message.reason, state.budget?.maxIterations);
      return text === null ? ready : withMessage(ready, { kind: "notice", text });
    }
    case "secret-request":
      return { ...state, pendingSecret: message.name };
    case "secret-approval-request":
      return { ...state, pendingSecretApproval: { name: message.name, hosts: message.hosts } };
    case "passkey-unlock-request":
      return {
        ...state,
        pendingPasskeyUnlock: {
          id: message.id,
          name: message.name,
          credentialId: message.credentialId,
          salt: message.salt,
        },
      };
    case "permission-request":
      return {
        ...state,
        pendingPermission: {
          id: message.id,
          name: message.name,
          args: message.args,
          serverId: message.serverId,
        },
      };
    case "oauth-signin-needed":
      return { ...state, pendingOAuthSignIn: { provider: message.provider } };
    case "oauth-authorize-url":
    case "oauth-signin-done":
      return state;
    // Answered by the session, which resolves the waiting panel; nothing on screen depends on it.
    case "probe-result":
      return state;
    case "draft-generated":
      return { ...state, generatedDraft: message.source, clarifyQuestions: [], draftError: null };
    case "draft-clarify":
      return { ...state, clarifyQuestions: message.questions, draftError: null };
    case "draft-generation-error":
      return { ...state, clarifyQuestions: [], draftError: message.message };
    case "error":
      return {
        ...state,
        error: message.message,
        status: state.status === "no-agent" ? "no-agent" : "ready",
      };
  }
}

function appendToAssistant(state: ChatState, text: string): ChatState {
  const last = state.messages[state.messages.length - 1];
  if (last !== undefined && last.kind === "assistant") {
    const updated: UiMessage = { ...last, text: last.text + text };
    return { ...state, messages: [...state.messages.slice(0, -1), updated] };
  }
  return withMessage(state, { kind: "assistant", text });
}

function updateTool(state: ChatState, callId: string, ok: boolean, content: string): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.kind === "tool" && message.callId === callId
        ? { ...message, status: ok ? "ok" : "failed", result: content }
        : message,
    ),
  };
}
