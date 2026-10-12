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

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { loadAgents, saveAgent, removeAgent } from "../agents-store";
import type { SavedAgent, AgentOrigin, AgentSaveResult } from "../agents-store";

interface AgentsLibraryValue {
  agents: SavedAgent[];
  save: (agent: { id?: string; name: string; description: string; source: string; origin: AgentOrigin }) => AgentSaveResult;
  remove: (id: string) => void;
}

const AgentsLibraryContext = createContext<AgentsLibraryValue | null>(null);

export function AgentsLibraryProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<SavedAgent[]>(() => loadAgents());

  const value: AgentsLibraryValue = {
    agents,
    save: (agent) => {
      const result = saveAgent(agent);
      setAgents(result.agents);
      return result;
    },
    remove: (id) => setAgents(removeAgent(id)),
  };

  return <AgentsLibraryContext.Provider value={value}>{children}</AgentsLibraryContext.Provider>;
}

export function useAgentsLibrary(): AgentsLibraryValue {
  const value = useContext(AgentsLibraryContext);
  if (value === null) {
    throw new Error("useAgentsLibrary must be used within an AgentsLibraryProvider");
  }
  return value;
}
