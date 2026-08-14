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

import { loadJsonArray, saveJson } from "./local-json-store";

export type AgentOrigin = "blank" | "template" | "ai-prompt" | "import" | "example";

export interface SavedAgent {
  id: string;
  name: string;
  description: string;
  source: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  origin: AgentOrigin;
}

const AGENTS_KEY = "afm.agents.v1";

export function loadAgents(): SavedAgent[] {
  return loadJsonArray<SavedAgent>(AGENTS_KEY);
}

function persist(agents: SavedAgent[]): boolean {
  return saveJson(AGENTS_KEY, agents);
}

export interface AgentSaveResult {
  agents: SavedAgent[];
  saved: SavedAgent;
  persisted: boolean;
}

export function saveAgent(
  agent: Omit<SavedAgent, "id" | "createdAt" | "updatedAt" | "favorite"> & { id?: string },
): AgentSaveResult {
  const existing = loadAgents();
  const now = Date.now();
  const id = agent.id ?? crypto.randomUUID();
  const previous = existing.find((a) => a.id === id);
  const next: SavedAgent = {
    id,
    name: agent.name,
    description: agent.description,
    source: agent.source,
    origin: agent.origin,
    favorite: previous?.favorite ?? false,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const rest = existing.filter((a) => a.id !== id);
  const agents = [next, ...rest];
  return { agents, saved: next, persisted: persist(agents) };
}

export function removeAgent(id: string): SavedAgent[] {
  const agents = loadAgents().filter((a) => a.id !== id);
  persist(agents);
  return agents;
}

export function toggleFavorite(id: string): SavedAgent[] {
  const agents = loadAgents().map((a) => (a.id === id ? { ...a, favorite: !a.favorite } : a));
  persist(agents);
  return agents;
}

export function findAgent(id: string): SavedAgent | null {
  return loadAgents().find((a) => a.id === id) ?? null;
}

export function clear(): SavedAgent[] {
  persist([]);
  return [];
}
