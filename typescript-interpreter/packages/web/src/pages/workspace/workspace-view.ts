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
