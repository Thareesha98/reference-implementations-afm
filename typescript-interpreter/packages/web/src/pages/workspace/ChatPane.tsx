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

import type { AgentStatus } from "../../chat-state";
import { MessageList } from "../../chat/MessageList";
import { Composer } from "../../chat/Composer";
import { PermissionRequestModal } from "../../overlay/PermissionRequestModal";
import type { useStandaloneSession } from "../../worker-client/useStandaloneSession";

// Composer's own fallback ("Load an agent first...") reads as a failed click once an agent exists, so
// each disabled status short of "ready" says what is happening instead.
const WAITING_PLACEHOLDER: Partial<Record<AgentStatus, string>> = {
  "no-agent": "Press Run to start…",
  connecting: "Loading the agent…",
  "not-ready": "The agent didn't start…",
};

interface Props {
  session: ReturnType<typeof useStandaloneSession>;
  serverNameByUrl: Map<string, string>;
  onReplaceKey: () => void;
  onRetry: () => void;
  /** What the agent says about itself, for the opening state. */
  description?: string;
  role?: string;
  iconUrl?: string;
}

export function ChatPane({
  session,
  serverNameByUrl,
  onReplaceKey,
  onRetry,
  description = "",
  role = "",
  iconUrl = "",
}: Props) {
  const { state, send, stop, attachFiles, detachFile, regenerate, editMessage, submitPermission } = session;
  const { pendingPermission } = state;

  return (
    <div className="xc">
      {state.status === "no-agent" ? (
        // The ways to start an agent live in the drawer; repeating them here showed the same
        // buttons twice.
        <div className="u-empty">
          <span className="u-empty-ico" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </span>
          <h4>Not started yet</h4>
          <p>
            Press <strong>Run</strong> and the conversation begins here.
          </p>
        </div>
      ) : (
        <MessageList
          messages={state.messages}
          streaming={state.status === "streaming"}
          status={state.status}
          agentName={state.agentName}
          iconUrl={iconUrl}
          loadSteps={state.loadSteps}
          notReady={state.notReady}
          description={description}
          role={role}
          onAsk={state.status === "ready" ? (question) => send(question) : undefined}
          onReplaceKey={onReplaceKey}
          onRetry={onRetry}
          onRegenerate={regenerate}
          onEdit={editMessage}
          onDetachFile={detachFile}
          serverOf={(toolName) => serverNameByUrl.get(state.tools.find((tool) => tool.name === toolName)?.serverId ?? "")}
        />
      )}

      <Composer
        onSend={send}
        onStop={stop}
        onAttach={attachFiles}
        streaming={state.status === "streaming"}
        disabled={state.status !== "ready" && state.status !== "streaming"}
        placeholder={WAITING_PLACEHOLDER[state.status]}
      />

      {pendingPermission !== null && (
        <PermissionRequestModal
          request={pendingPermission}
          description={state.tools.find((tool) => tool.name === pendingPermission.name)?.description}
          onDecide={(allow, remember) => submitPermission(pendingPermission.id, allow, remember)}
        />
      )}
    </div>
  );
}
