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

import type { AgentStatus, ChatState } from "../chat-state";

const BODY_MAX_CHARS = 140;

export function shouldNotify(
  prevStatus: AgentStatus,
  status: AgentStatus,
  hidden: boolean,
  enabled: boolean,
  permission: string,
): boolean {
  return prevStatus === "streaming" && status === "ready" && hidden && enabled && permission === "granted";
}

export function notificationContent(state: ChatState): { title: string; body: string } {
  const title = state.agentName || "AFM Agent";
  if (state.error !== null) {
    return { title, body: state.error.slice(0, BODY_MAX_CHARS) };
  }
  const lastAssistant = [...state.messages].reverse().find((m) => m.kind === "assistant");
  if (lastAssistant !== undefined && lastAssistant.kind === "assistant" && lastAssistant.text !== "") {
    return { title, body: lastAssistant.text.slice(0, BODY_MAX_CHARS) };
  }
  return { title, body: "Your agent finished responding." };
}
