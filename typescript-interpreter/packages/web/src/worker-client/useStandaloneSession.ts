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
import type { UiMessage, PendingPermission, PendingPasskeyUnlock } from "../chat-state";
import { seal, unlockAll } from "../passkey/vault";
import { createOAuthSignIns, type OAuthSignIns } from "../oauth-signin";

export interface SessionHooks {
  agentId?: () => string | null;
  permissionSeed?: () => string[];
  onRememberPermission?: (request: PendingPermission, allow: boolean) => void;
}

export interface ProbeResult {
  tools?: ToolInfo[];
  error?: string;
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
  const lastLoadIdRef = useRef<string>("");
  const lastSourceRef = useRef<string>("");

  const activeProbesRef = useRef<Set<string>>(new Set());
  const probeWaitersRef = useRef<Map<string, (result: ProbeResult) => void>>(new Map());
  const oauthRef = useRef<OAuthSignIns | null>(null);
  oauthRef.current ??= createOAuthSignIns({
    post,
    onPopupBlocked: () => dispatch({ type: "server", message: { type: "notice", text: "Allow pop-ups for this site to sign in." } }),
    onSettled: () => dispatch({ type: "oauth-signin-dismissed" }),
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
        activeProbesRef.current.delete(message.id);
        probeWaitersRef.current.get(message.id)?.({ tools: message.tools, error: message.error });
        probeWaitersRef.current.delete(message.id);
        return;
      }
      if (message.type === "oauth-signin-needed") {
        if (message.loadId !== lastLoadIdRef.current && !activeProbesRef.current.has(message.loadId)) return;
        dispatch({ type: "server", message });
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
    const loadId = crypto.randomUUID();
    lastLoadIdRef.current = loadId;
    lastSourceRef.current = content;

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
        loadId,
        permissionSeed,
      });
      return;
    }
    post({ type: "load", content, loadId, permissionSeed });
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

  /** Puts the pane back to "no agent yet" when the editor moves to a different agent. */
  function clearAgent(): void {
    lastLoadIdRef.current = "";
    lastSourceRef.current = "";
    dispatch({ type: "agent-cleared" });
    post({ type: "reset-chat" });
  }

  function submitSecret(name: string, value: string | null): void {
    dispatch({ type: "secret-dismissed" });
    post({ type: "secret-response", name, value });
  }

  function removeSecret(name: string): void {
    post({ type: "remove-secret", name });
  }

  /**
   * Files a secret the UI already holds, such as an MCP auth field, so the file only carries the
   * `${env:NAME}` reference. Optionally seals it behind the device passkey, as the model key is.
   */
  async function storeMcpSecret(name: string, value: string, saveOnDevice: boolean): Promise<boolean> {
    post({ type: "set-secret", name, value });
    return saveOnDevice ? rememberWithPasskey(name) : false;
  }

  /**
   * The one way a typed key is stored. `withPasskey` comes from the caller, which knows whether the
   * device can do it; checking here would spend the user gesture the authenticator needs. A failed
   * or cancelled seal leaves the key working for this tab.
   */
  async function saveSecret(name: string, value: string, withPasskey: boolean): Promise<boolean> {
    submitSecret(name, value);
    return withPasskey ? rememberWithPasskey(name) : false;
  }

  // Seal a secret the worker already holds behind the device passkey. Must run inside the click.
  function rememberWithPasskey(name: string): Promise<boolean> {
    return seal(post, name);
  }

  function forgetPasskey(name: string): void {
    post({ type: "passkey-forget", name });
  }

  // The panel's own "Unlock": one ceremony opens every sealed key (see passkey/vault).
  function unlockSecret(): Promise<boolean> {
    return unlockAll(post);
  }

  // Answer the worker's unlock request, opening every other sealed key in the same ceremony.
  async function unlockPasskey(request: PendingPasskeyUnlock): Promise<void> {
    dispatch({ type: "passkey-unlock-dismissed" });
    await unlockAll(post, request);
  }

  function skipPasskeyUnlock(id: string): void {
    dispatch({ type: "passkey-unlock-dismissed" });
    post({ type: "passkey-unlock-response", id, key: null });
  }

  function decideSecretApproval(name: string, approved: boolean): void {
    dispatch({ type: "secret-dismissed" });
    post({ type: "secret-approval-response", name, approved });
  }

  // Opens the sign-in popup on this click and resolves true once the worker has the tokens.
  function startOAuthSignIn(provider: OAuthProviderRef, remember = false): Promise<boolean> {
    return oauth.start(provider, remember);
  }

  async function signInForOAuth(remember = false): Promise<void> {
    const pending = state.pendingOAuthSignIn;
    if (pending === null) return;
    if (await startOAuthSignIn(pending.provider, remember)) regenerate();
  }

  // Drops the worker's session for this server (access and refresh tokens). Never touches the agent
  // file.
  function signOutOAuth(provider: OAuthProviderRef): void {
    post({ type: "oauth-sign-out", provider });
  }

  function dismissOAuthSignIn(): void {
    dispatch({ type: "oauth-signin-dismissed" });
  }

  function submitPermission(id: string, allow: boolean, remember: boolean): void {
    const request = state.pendingPermission;
    dispatch({ type: "permission-dismissed" });
    post({ type: "permission-response", id, decision: allow ? "allow" : "deny", remember });
    // The worker only remembers while it lives; recording it here makes "don't ask again" survive a
    // reload or restart.
    if (remember && request !== null && request.id === id) {
      hooksRef.current.onRememberPermission?.(request, allow);
    }
  }

  function generateDraft(prompt: string, model: AgentModelRef, final?: boolean): void {
    dispatch({ type: "draft-dismissed" });
    post({ type: "generate-draft", prompt, model, final });
  }

  /**
   * Asks one server what tools it has without starting the agent, so tools can be chosen when the
   * server is added.
   */
  function probeServer(server: NonNullable<AgentMetadata["tools"]>): Promise<ProbeResult> {
    const id = crypto.randomUUID();
    activeProbesRef.current.add(id);
    return new Promise((resolve) => {
      // The worker gives up first and says why; this is only for when it never answers, since a
      // spinner with nothing behind it is the worst outcome.
      const deadline = window.setTimeout(() => {
        activeProbesRef.current.delete(id);
        probeWaitersRef.current.delete(id);
        resolve({ error: "The server did not answer in time. Check the address and try again." });
      }, PROBE_DEADLINE_MS);
      probeWaitersRef.current.set(id, (result) => {
        window.clearTimeout(deadline);
        resolve(result);
      });
      post({ type: "probe-server", id, server });
    });
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
    submitSecret,
    saveSecret,
    storeMcpSecret,
    unlockSecret,
    removeSecret,
    decideSecretApproval,
    signInForOAuth,
    startOAuthSignIn,
    signOutOAuth,
    dismissOAuthSignIn,
    submitPermission,
    generateDraft,
    dismissDraft,
    probeServer,
    rememberWithPasskey,
    forgetPasskey,
    unlockPasskey,
    skipPasskeyUnlock,
  };
}
