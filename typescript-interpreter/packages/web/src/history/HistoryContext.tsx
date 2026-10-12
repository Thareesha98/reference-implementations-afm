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

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  loadHistory,
  upsertHistoryEntry,
  removeHistoryEntriesForAgent,
  importHistoryEntries,
} from "../history-store";
import type { HistoryEntry } from "../history-store";

interface HistoryValue {
  entries: HistoryEntry[];
  upsert: (entry: HistoryEntry) => void;
  removeForAgent: (agentId: string) => void;
  restore: (entries: HistoryEntry[]) => void;
}

const HistoryContext = createContext<HistoryValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let live = true;
    void loadHistory().then((loaded) => {
      if (live) setEntries(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  const value: HistoryValue = {
    entries,
    upsert: (entry) => void upsertHistoryEntry(entry).then(setEntries),
    removeForAgent: (agentId) => void removeHistoryEntriesForAgent(agentId).then(setEntries),
    restore: (imported) => void importHistoryEntries(imported).then(setEntries),
  };

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryValue {
  const value = useContext(HistoryContext);
  if (value === null) {
    throw new Error("useHistory must be used within a HistoryProvider");
  }
  return value;
}
