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

import { useEffect, useReducer, useRef } from "react";
import { chatReducer, initialChatState } from "../chat-state";
import type { OAuthProviderRef } from "@afm/adapter-auth";
import type { ClientMessage, ServerMessage, AgentModelRef, ImageAttachment, ToolInfo } from "../protocol";
import type { AgentMetadata } from "@afm/engine";
import { extractFiles } from "../attachments";
import type { CollectedFile } from "../attachments";
import { toSeededConversation } from "../session-store";
import type { UiMessage, PendingPermission } from "../chat-state";
import type { Failure } from "../failure";
import { seal, unlockAll } from "../passkey/vault";
import { createOAuthSignIns, type OAuthSignIns } from "../oauth-signin";

export interface SessionHooks {
  agentId?: () => string | null;
  permissionSeed?: () => string[];
  onRememberPermission?: (request: PendingPermission, allow: boolean) => void;
}

export interface ProbeResult {
  tools?: ToolInfo[];
  failure?: Failure;
}

export interface LoadOptions {
  carryConversation?: boolean;
}

/** Marks where the agent changed, so the thread above does not look like this agent's work. */
function freshStartNotice(messages: UiMessage[]): UiMessage {
  const highest = messages.reduce((max, message) => Math.max(max, message.id), 0);
  return {
    kind: "notice",
    id: highest + 1,
    text:
      "You changed what this agent is, so it starts fresh here. It cannot see the replies " +
      "above - those were written by the previous version.",
  };
}

/** Only reached if the worker never answers; it has its own, shorter limit. */
const PROBE_DEADLINE_MS = 30_000;

export function useStandaloneSession(hooks: SessionHooks = {}) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  // Held in a ref so callbacks close over fresh state without rebuilding the worker.
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const workerRef = useRef<Worker | null>(null);

  const outboxRef = useRef<ClientMessage[]>([]);

  const probeWaitersRef = useRef<Map<string, (result: ProbeResult) => void>>(new Map());
  const oauthRef = useRef<OAuthSignIns | null>(null);
  oauthRef.current ??= createOAuthSignIns({
    post,
    onPopupBlocked: () => dispatch({ type: "server", message: { type: "notice", text: "Allow pop-ups for this site to sign in." } }),
    onFailure: (text) => dispatch({ type: "server", message: { type: "notice", text } }),
  });
  const oauth = oauthRef.current;

  useEffect(() => {
    const worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const onMessage = (event: MessageEvent<ServerMessage>) => {
      const message = event.data;

      if (message.type === "oauth-authorize-url") {
        oauth.onAuthorizeUrl(message.id, message.url);
        return;
      }
      if (message.type === "oauth-signin-done") {
        oauth.onDone(message.id, message.ok, message.error);
        return;
      }
      if (message.type === "probe-result") {
        probeWaitersRef.current.get(message.id)?.({ tools: message.tools, failure: message.failure });
        probeWaitersRef.current.delete(message.id);
        return;
      }
      dispatch({ type: "server", message });
    };
    worker.addEventListener("message", onMessage);
    for (const queued of outboxRef.current.splice(0)) worker.postMessage(queued);
    worker.postMessage({ type: "list-secrets" } satisfies ClientMessage);
    worker.postMessage({ type: "list-passkeys" } satisfies ClientMessage);

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      workerRef.current = null;
      outboxRef.current.length = 0;
    };
  }, []);

  function post(message: ClientMessage): void {
    const worker = workerRef.current;
    if (worker === null) {
      outboxRef.current.push(message);
      return;
    }
    worker.postMessage(message);
  }

  function loadContent(content: string, resume?: UiMessage[], options: LoadOptions = {}): void {
    const permissionSeed = hooksRef.current.permissionSeed?.() ?? [];
    dispatch({ type: "agent-loading", content, keepMessages: false });
    if (resume !== undefined && resume.length > 0) {
      const carry = options.carryConversation !== false;
      dispatch({
        type: "restore-session",
        messages: carry ? resume : [...resume, freshStartNotice(resume)],
        agentSource: content,
      });
      post({
        type: "load",
        content,
        seedHistory: carry ? toSeededConversation(resume) : [],
        permissionSeed,
      });
      return;
    }
    post({ type: "load", content, permissionSeed });
  }

  function send(text: string, images?: ImageAttachment[]): void {
    dispatch({ type: "user-message", text, images });
    post({ type: "send", text, images });
  }

  function stop(): void {
    post({ type: "cancel" });
  }

  async function attachFiles(collected: CollectedFile[]) {
    const { attached, skipped } = await extractFiles(collected);
    if (attached.length > 0) {
      dispatch({
        type: "files-attached",
        files: attached.map((f) => ({ name: f.name, path: f.path, chars: f.text.length, pages: f.pages })),
      });
      post({ type: "attach-files", files: attached });
    }
    return { attached: attached.map((f) => f.name), skipped };
  }

  function detachFile(messageId: number, key: string): void {
    dispatch({ type: "file-detached", id: messageId, key });
    post({ type: "detach-file", path: key });
  }

  /**
   * Replaces the last answer: the reducer drops it from the transcript and the worker from the
   * history, so the model is asked the same question against the same context.
   */
  function regenerate(): void {
    dispatch({ type: "regenerate-start" });
    post({ type: "regenerate" });
  }

  function editMessage(id: number, text: string): void {
    const original = state.messages.find((message) => message.id === id);
    const images = original?.kind === "user" ? original.images : undefined;
    const keep = state.messages.filter((message) => message.kind === "user" && message.id < id).length;
    dispatch({ type: "rewind", id });
    dispatch({ type: "user-message", text, images });
    post({ type: "send", text, images, keep });
  }

  /** Puts the pane back to "no agent yet" when the editor moves to a different agent. */
  function clearAgent(): void {
    dispatch({ type: "agent-cleared" });
    post({ type: "reset-chat" });
  }

  function removeSecret(name: string): void {
    post({ type: "remove-secret", name });
  }

  /**
   * Hands the worker a typed value, approved for `host` when it is a server's. Optionally seals it
   * behind the device passkey; a failed or cancelled seal leaves it working for this tab.
   */
  async function storeSecret(name: string, value: string, keep: boolean, host?: string): Promise<boolean> {
    post({ type: "set-secret", name, value, host });
    return keep ? rememberWithPasskey(name) : false;
  }

  // Seal a secret the worker already holds behind the device passkey. Must run inside the click.
  function rememberWithPasskey(name: string): Promise<boolean> {
    return seal(post, name);
  }

  function forgetPasskey(name: string): void {
    post({ type: "passkey-forget", name });
  }

  // One ceremony opens every sealed key (see passkey/vault). Must run inside the click.
  function openKeys(): Promise<boolean> {
    return unlockAll(post);
  }

  // Opens the sign-in popup on this click and resolves true once the worker has the tokens.
  function startOAuthSignIn(provider: OAuthProviderRef, remember = false): Promise<boolean> {
    return oauth.start(provider, remember);
  }

  // Drops the worker's session for this server (access and refresh tokens). Never touches the agent
  // file.
  function signOutOAuth(provider: OAuthProviderRef): void {
    post({ type: "oauth-sign-out", provider });
  }

  function submitPermission(id: string, allow: boolean, remember: boolean): void {
    const request = state.pendingPermission;
    dispatch({ type: "permission-dismissed" });
    post({ type: "permission-response", id, decision: allow ? "allow" : "deny", remember });
    // The worker forgets on every load; recording it here keeps "don't ask again" across loads in
    // this tab.
    if (remember && request !== null && request.id === id) {
      hooksRef.current.onRememberPermission?.(request, allow);
    }
  }

  function generateDraft(prompt: string, model: AgentModelRef, final?: boolean): void {
    dispatch({ type: "draft-dismissed" });
    post({ type: "generate-draft", prompt, model, final });
  }

  function probe(message: (id: string) => ClientMessage): Promise<ProbeResult> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      // The worker gives up first and says why; this is only for when it never answers, since a
      // spinner with nothing behind it is the worst outcome.
      const deadline = window.setTimeout(() => {
        probeWaitersRef.current.delete(id);
        resolve({ failure: { kind: "slow", message: "Nothing answered in time." } });
      }, PROBE_DEADLINE_MS);
      probeWaitersRef.current.set(id, (result) => {
        window.clearTimeout(deadline);
        resolve(result);
      });
      post(message(id));
    });
  }

  function probeServer(server: NonNullable<AgentMetadata["tools"]>): Promise<ProbeResult> {
    return probe((id) => ({ type: "probe-server", id, server }));
  }

  function probeModel(model: AgentModelRef): Promise<ProbeResult> {
    return probe((id) => ({ type: "probe-model", id, model }));
  }

  /** Drops the written file without using it, so the review screen closes. */
  function dismissDraft(): void {
    dispatch({ type: "draft-dismissed" });
  }

  return {
    state,
    loadContent,
    send,
    stop,
    attachFiles,
    detachFile,
    clearAgent,
    regenerate,
    editMessage,
    storeSecret,
    openKeys,
    removeSecret,
    startOAuthSignIn,
    signOutOAuth,
    submitPermission,
    generateDraft,
    dismissDraft,
    probeServer,
    probeModel,
    rememberWithPasskey,
    forgetPasskey,
  };
}
