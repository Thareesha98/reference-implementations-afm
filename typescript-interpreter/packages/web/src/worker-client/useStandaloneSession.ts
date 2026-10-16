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
import type { ClientMessage, ServerMessage, AgentModelRef, ImageAttachment, SignInVetting, ToolInfo } from "../protocol";
import type { AgentMetadata } from "@afm/engine";
import { MAX_TOTAL_BYTES, extractFiles } from "../attachments";
import { startBlobWorker } from "../blob-worker";
import agentWorkerUrl from "../worker.ts?worker&url";
import { describeError } from "@afm/engine";
import type { CollectedFile } from "../attachments";
import { toSeededConversation } from "../session-store";
import type { UiMessage, PendingPermission } from "../chat-state";
import type { Failure } from "../failure";
import { createOAuthSignIns, type OAuthSignIns, type SignInOutcome } from "../oauth-signin";

export interface SessionHooks {
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

const PROBE_DEADLINE_MS = 30_000;

export function useStandaloneSession(hooks: SessionHooks = {}) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const workerRef = useRef<Worker | null>(null);

  const outboxRef = useRef<ClientMessage[]>([]);

  const probeWaitersRef = useRef<Map<string, (result: ProbeResult) => void>>(new Map());
  const attachedBytesRef = useRef<Map<string, number>>(new Map());
  const oauthRef = useRef<OAuthSignIns | null>(null);
  oauthRef.current ??= createOAuthSignIns({ post });
  const oauth = oauthRef.current;

  useEffect(() => {
    let worker: Worker | null = null;
    let live = true;

    const onMessage = (event: MessageEvent<ServerMessage>) => {
      const message = event.data;

      if (message.type === "oauth-authorize-url") {
        oauth.onAuthorizeUrl(message.id, message.url);
        return;
      }
      if (message.type === "oauth-signin-confirm") {
        oauth.onConfirm(message.id, message.host);
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
    startBlobWorker(agentWorkerUrl).then(
      (started) => {
        if (!live) {
          started.terminate();
          return;
        }
        worker = started;
        workerRef.current = started;
        started.addEventListener("message", onMessage);
        for (const queued of outboxRef.current.splice(0)) started.postMessage(queued);
        started.postMessage({ type: "list-secrets" } satisfies ClientMessage);
      },
      (error: unknown) => {
        if (live) dispatch({ type: "server", message: { type: "error", message: `The agent could not be started: ${describeError(error)}` } });
      },
    );

    return () => {
      live = false;
      worker?.removeEventListener("message", onMessage);
      worker?.terminate();
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
    attachedBytesRef.current.clear();
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
    const attachedBytes = attachedBytesRef.current;
    const remaining = MAX_TOTAL_BYTES - [...attachedBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
    const { attached, skipped, sizes } = await extractFiles(collected, remaining);
    for (const [path, bytes] of sizes) attachedBytes.set(path, bytes);
    if (attached.length > 0) {
      dispatch({
        type: "files-attached",
        files: attached.map((f) => ({ name: f.name, path: f.path, chars: f.text.length, pages: f.pages, note: f.note })),
      });
      post({ type: "attach-files", files: attached });
    }
    return { attached: attached.map((f) => (f.note === undefined ? f.name : `${f.name} (${f.note})`)), skipped };
  }

  function detachFile(messageId: number, key: string): void {
    attachedBytesRef.current.delete(key);
    dispatch({ type: "file-detached", id: messageId, key });
    post({ type: "detach-file", path: key });
  }

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

  function clearAgent(): void {
    dispatch({ type: "agent-cleared" });
    post({ type: "reset-chat" });
  }

  function removeSecret(name: string): void {
    post({ type: "remove-secret", name });
  }

  function storeSecret(name: string, value: string, address?: string): void {
    post({ type: "set-secret", name, value, address });
  }

  function startOAuthSignIn(provider: OAuthProviderRef, vetting: SignInVetting): Promise<SignInOutcome> {
    return oauth.start(provider, vetting);
  }

  function signOutOAuth(provider: OAuthProviderRef): void {
    post({ type: "oauth-sign-out", provider });
  }

  function submitPermission(id: string, allow: boolean, remember: boolean): void {
    const request = state.pendingPermission;
    dispatch({ type: "permission-dismissed" });
    post({ type: "permission-response", id, decision: allow ? "allow" : "deny", remember });
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
    removeSecret,
    startOAuthSignIn,
    signOutOAuth,
    submitPermission,
    generateDraft,
    dismissDraft,
    probeServer,
    probeModel,
  };
}
