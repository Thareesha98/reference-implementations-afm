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

import { useEffect, useRef, useState } from "react";
import type { ChatState, UiMessage } from "../../chat-state";
import type { ToolInfo } from "../../protocol";
import { lastUserIndex } from "../../chat-state";

export type ActivityPhase =
  | "idle"
  | "incoming"
  | "thinking"
  | "from-model"
  | "tool"
  | "from-tool"
  | "answering";

export interface AgentActivity {
  phase: ActivityPhase;
  serverId?: string;
  brokenServerIds: string[];
  modelBroken: boolean;
}

interface PhasePoint {
  phase: ActivityPhase;
  serverId?: string;
}

function runningTool(messages: UiMessage[]): UiMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.kind === "tool" && message.status === "running") return message;
  }
  return undefined;
}

function lastAssistantHasText(messages: UiMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.kind === "assistant" && last.text.trim() !== "";
}

function serverOf(toolName: string, tools: ToolInfo[]): string | undefined {
  return tools.find((tool) => tool.name === toolName)?.serverId;
}

function brokenLines(state: ChatState, tools: ToolInfo[]): { servers: string[]; model: boolean } {
  const turnStart = lastUserIndex(state.messages);
  if (turnStart === -1) return { servers: [], model: false };

  const servers = new Set<string>();
  for (const message of state.messages.slice(turnStart + 1)) {
    if (message.kind !== "tool" || message.status !== "failed") continue;
    const serverId = serverOf(message.name, tools);
    if (serverId !== undefined) servers.add(serverId);
  }
  return { servers: [...servers], model: state.error !== null && servers.size === 0 };
}

export function reportedActivity(state: ChatState, tools: ToolInfo[]): AgentActivity {
  const broken = brokenLines(state, tools);
  const rest = { brokenServerIds: broken.servers, modelBroken: broken.model };

  if (state.status === "connecting") return { phase: "thinking", ...rest };
  if (state.status !== "streaming") return { phase: "idle", ...rest };

  const running = runningTool(state.messages);
  if (running !== undefined && running.kind === "tool") {
    return { phase: "tool", serverId: serverOf(running.name, tools), ...rest };
  }
  return { phase: lastAssistantHasText(state.messages) ? "answering" : "thinking", ...rest };
}

type Leg = { phase: "incoming" | "from-model" | "from-tool"; serverId?: string };

const LEG_MS: Record<Leg["phase"], number> = {
  incoming: 700,
  "from-model": 620,
  "from-tool": 620,
};

export function legAfter(prev: PhasePoint, next: PhasePoint, newMessage: boolean): Leg | null {
  if (newMessage) return { phase: "incoming" };
  if (next.phase === "idle") return null;
  if (prev.phase === "thinking" && next.phase === "tool") return { phase: "from-model" };
  if (prev.phase === "tool" && prev.serverId !== undefined && next.serverId !== prev.serverId) {
    return { phase: "from-tool", serverId: prev.serverId };
  }
  return null;
}

export function useAgentActivity(state: ChatState): AgentActivity {
  const reported = reportedActivity(state, state.tools);
  const [leg, setLeg] = useState<Leg | null>(null);
  const previous = useRef<PhasePoint>({ phase: "idle" });

  const userCount = state.messages.filter((message) => message.kind === "user").length;
  const seenUserCount = useRef(userCount);
  const { phase, serverId } = reported;

  useEffect(() => {
    const next = legAfter(previous.current, { phase, serverId }, userCount > seenUserCount.current);
    previous.current = { phase, serverId };
    seenUserCount.current = userCount;
    if (next === null) return;

    setLeg(next);
    const timer = window.setTimeout(() => setLeg(null), LEG_MS[next.phase]);
    return () => window.clearTimeout(timer);
  }, [phase, serverId, userCount]);

  const running = state.status === "streaming" || state.status === "connecting";
  if (leg !== null && running) return { ...reported, phase: leg.phase, serverId: leg.serverId };
  return reported;
}
