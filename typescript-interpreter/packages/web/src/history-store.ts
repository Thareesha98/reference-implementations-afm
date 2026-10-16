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

import type { UiMessage } from "./chat-state";

export interface HistoryEntry {
  id: string;
  agentId: string | null;
  agentName: string;
  agentSource: string;
  messages: UiMessage[];
  tokenCount: number;
  startedAt: number;
  updatedAt: number;
}

const HISTORY_MAX = 200;
const STORED_DATABASE = "afm-history";
const STORED_KEY = "afm.history.v1";

function byRecency(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function newest(entries: HistoryEntry[]): HistoryEntry[] {
  return byRecency(entries).slice(0, HISTORY_MAX);
}

export function mergeHistory(existing: HistoryEntry[], imported: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of imported) {
    const current = byId.get(item.id);
    if (current === undefined || item.updatedAt >= current.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return byRecency([...byId.values()]);
}

export function withHistoryEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return newest([...entries.filter((item) => item.id !== entry.id), entry]);
}

export function withoutAgentHistory(entries: HistoryEntry[], agentId: string): HistoryEntry[] {
  return entries.filter((entry) => entry.agentId !== agentId);
}

export function withImportedHistory(entries: HistoryEntry[], imported: HistoryEntry[]): HistoryEntry[] {
  return newest(mergeHistory(entries, imported));
}

export function clearStoredHistory(): void {
  try {
    indexedDB.deleteDatabase(STORED_DATABASE);
    localStorage.removeItem(STORED_KEY);
  } catch {
    return;
  }
}
