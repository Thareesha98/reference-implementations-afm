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

import { MessageList } from "../../chat/MessageList";
import { Composer } from "../../chat/Composer";
import { PermissionRequestModal } from "../../overlay/PermissionRequestModal";
import { SetupFrame, KeyStep, UnlockStep, ApprovalStep, SignInStep } from "./SetupSteps";
import { ToolStep } from "./ToolStep";
import { setupPlan } from "./readiness";
import type { useStandaloneSession } from "../../worker-client/useStandaloneSession";
import { hostOf } from "../../load-paths";
import { envSecretName, getModelApiKey } from "./agent-source-edit";

interface Props {
  session: ReturnType<typeof useStandaloneSession>;
  content: string;
  /** True once the agent is up and its servers have not been narrowed down. */
  needsToolChoice: boolean;
  /** Every step the agent still needs, known before the first one. */
  setupSteps: ReturnType<typeof setupPlan>;
  serverNameByUrl: Map<string, string>;
  onChooseTools: (allowedByServer: Map<string, string[]>) => void;
  /** What the agent says about itself, for the opening state. */
  description?: string;
  role?: string;
}

export function ChatPane({
  session,
  content,
  needsToolChoice,
  setupSteps,
  serverNameByUrl,
  onChooseTools,
  description = "",
  role = "",
}: Props) {
  const {
    state,
    loadContent,
    send,
    stop,
    attachFiles,
    detachFile,
    saveSecret,
    regenerate,
    unlockPasskey,
    skipPasskeyUnlock,
    decideSecretApproval,
    signInForOAuth,
    dismissOAuthSignIn,
    submitPermission,
    removeSecret,
    forgetPasskey,
  } = session;
  const { pendingSecret, pendingPermission, pendingSecretApproval, pendingPasskeyUnlock, pendingOAuthSignIn } =
    state;

  // Setup happens in the conversation, in front of the composer. The plan comes from the file, so
  // the line reads "Key - Sign in - Tools" from the first question rather than growing.
  const currentStep =
    pendingSecret !== null || pendingSecretApproval !== null || pendingPasskeyUnlock !== null
      ? "key"
      : pendingOAuthSignIn !== null
        ? "signin"
        : "tools";
  const setup =
    pendingPasskeyUnlock !== null ? (
      <UnlockStep
        name={pendingPasskeyUnlock.name}
        onUnlock={() => void unlockPasskey(pendingPasskeyUnlock)}
        onSkip={() => skipPasskeyUnlock(pendingPasskeyUnlock.id)}
      />
    ) : pendingSecret !== null ? (
      <KeyStep
        name={pendingSecret}
        onSubmit={(value, withPasskey) => void saveSecret(pendingSecret, value, withPasskey)}
      />
    ) : pendingSecretApproval !== null ? (
      <ApprovalStep
        name={pendingSecretApproval.name}
        hosts={pendingSecretApproval.hosts}
        onDecide={(approved) => decideSecretApproval(pendingSecretApproval.name, approved)}
      />
    ) : pendingOAuthSignIn !== null ? (
      <SignInStep
        host={hostOf(pendingOAuthSignIn.provider.authorizeUrl)}
        onSignIn={signInForOAuth}
        onCancel={dismissOAuthSignIn}
      />
    ) : null;

  return (
    <div className="xc">
      {setup !== null ? (
        <SetupFrame steps={setupSteps} currentId={currentStep}>
          {setup}
        </SetupFrame>
      ) : needsToolChoice ? (
        <SetupFrame steps={setupSteps} currentId="tools">
          <ToolStep tools={state.tools} nameByUrl={serverNameByUrl} onConfirm={onChooseTools} />
        </SetupFrame>
      ) : state.status === "no-agent" ? (
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
          loadSteps={state.loadSteps}
          notReady={state.notReady}
          description={description}
          role={role}
          onAsk={state.status === "ready" ? (question) => send(question) : undefined}
          onReplaceKey={() => {
            // Only the agent's own model key goes, its sealed copy too, or the next load unlocks
            // the old one. Other keys and sign-ins are not this button's to remove.
            const name = envSecretName(getModelApiKey(content));
            if (name !== "") {
              forgetPasskey(name);
              removeSecret(name);
            }
            loadContent(content);
          }}
          onRetry={() => loadContent(content)}
          onRegenerate={regenerate}
          onDetachFile={detachFile}
        />
      )}

      <Composer
        onSend={send}
        onStop={stop}
        onAttach={attachFiles}
        streaming={state.status === "streaming"}
        disabled={state.status !== "ready" && state.status !== "streaming"}
        // Composer's fallback ("Load an agent first...") is for status "no-agent". Mid-run the same
        // words would read as a failed click, so each disabled status short of "ready" gets its own
        // line.
        placeholder={
          state.status === "no-agent"
            ? "Press Run to start the agent…"
            : state.status === "connecting"
              ? "Loading the agent…"
              : state.status === "testing"
                ? "Checking its tools…"
                : undefined
        }
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
