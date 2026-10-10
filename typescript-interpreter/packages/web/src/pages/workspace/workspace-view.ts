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

/**
 * What the side window shows, or null when the builder has the whole room. One slot, one thing at a
 * time. The stage is not one of these: it never hides.
 */
export type SidePanel = "chat" | "model" | "tools" | "share" | "settings" | "agents" | "start" | "info" | "setup";

export const SIDE_TITLE: Record<SidePanel, string> = {
  chat: "Chat",
  model: "Model",
  tools: "Connect tools",
  share: "Share",
  settings: "Settings",
  agents: "Agents",
  start: "Start an agent",
  info: "About",
  setup: "Setup",
};

/**
 * What the side window shows, and what it was opened over. Closing a panel gives back what was on
 * screen before it: a glance at the tools or the model while chatting must not cost the chat.
 */
export interface SideState {
  open: SidePanel | null;
  /** Bottom first, so the last one is where closing the current panel goes. */
  under: SidePanel[];
}

export const NOTHING_OPEN: SideState = { open: null, under: [] };

// The surfaces a person is working in. Everything else is a panel opened over one of them.
const WORKING_SURFACES: readonly SidePanel[] = ["chat", "start"];

/** A surface starts fresh; a panel keeps what the surface it was opened over, if any, is. */
export function openPanel(state: SideState, next: SidePanel): SideState {
  if (WORKING_SURFACES.includes(next)) return { open: next, under: [] };
  const over = state.open !== null && WORKING_SURFACES.includes(state.open) ? [state.open] : state.under;
  return { open: next, under: over };
}

/** Opens `next` over the current panel, which closing it comes back to (Setup's Configure). */
export function openOver(state: SideState, next: SidePanel): SideState {
  return state.open === null ? { open: next, under: [] } : { open: next, under: [...state.under, state.open] };
}

/** Closes the current panel, back to whatever it was opened over, or to nothing. */
export function closePanel(state: SideState): SideState {
  const below = state.under[state.under.length - 1];
  return below === undefined ? NOTHING_OPEN : { open: below, under: state.under.slice(0, -1) };
}

/** The top bar's buttons: a second press on the one that is showing closes it. */
export function togglePanel(state: SideState, next: SidePanel): SideState {
  return state.open === next ? closePanel(state) : openPanel(state, next);
}
