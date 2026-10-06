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
import { AgentAvatar } from "../../chat/AgentAvatar";
import type { ActivityPhase } from "./agent-activity";

export interface ChatStatus {
  tone: "ok" | "warn" | "bad";
  label: string;
}

const IDLE: Record<Exclude<AgentStatus, "streaming">, ChatStatus | null> = {
  ready: { tone: "ok", label: "Ready" },
  connecting: { tone: "warn", label: "Starting" },
  testing: { tone: "warn", label: "Checking tools" },
  "not-ready": { tone: "bad", label: "Needs attention" },
  "no-agent": null,
};

export function headerStatus(status: AgentStatus, phase: ActivityPhase, server?: string): ChatStatus | null {
  if (status !== "streaming") return IDLE[status];
  if (phase === "tool") return { tone: "warn", label: server === undefined ? "Using a tool" : `Using ${server}` };
  return phase === "answering" ? { tone: "ok", label: "Answering" } : { tone: "warn", label: "Thinking" };
}

export function ChatHead({ name, iconUrl, status }: { name: string; iconUrl: string; status: ChatStatus | null }) {
  return (
    <>
      <AgentAvatar className="xc-av sm" name={name} iconUrl={iconUrl} />
      <span className="u-who">
        <span className="u-panel-title">{name}</span>
        {status !== null && <span className={`u-state ${status.tone}`}>{status.label}</span>}
      </span>
    </>
  );
}

export function StatusPill({ status }: { status: ChatStatus | null }) {
  return status === null ? null : <span className={`u-state pill ${status.tone}`}>{status.label}</span>;
}
