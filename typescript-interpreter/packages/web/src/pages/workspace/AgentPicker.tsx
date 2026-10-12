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

import { useState } from "react";
import { useAgentsLibrary } from "../../agents/AgentsLibraryContext";
import { useHistory } from "../../history/HistoryContext";
import { UndoToast } from "../../overlay/UndoToast";
import { usePermissionsLedger } from "../../permissions/PermissionsLedgerContext";
import { permissionScopeFor } from "../../permissions-store";
import { markColour } from "./mark-colour";
import type { HistoryEntry } from "../../history-store";
import type { SavedAgent } from "../../agents-store";

const DAY = 24 * 60 * 60 * 1000;

interface Props {
  currentId: string | null;
  onPick: (agent: SavedAgent) => void;
  onNew: () => void;
}

export function AgentPicker({ currentId, onPick, onNew }: Props) {
  const library = useAgentsLibrary();
  const history = useHistory();
  const permissions = usePermissionsLedger();
  const [undo, setUndo] = useState<{ agent: SavedAgent; conversations: HistoryEntry[] } | null>(null);
  const [query, setQuery] = useState("");

  const shown = library.agents.filter((agent) =>
    query.trim() === "" ? true : agent.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const now = Date.now();

  return (
    <>
      <div className="u-panel-body u-agents">
        <label className="u-agent-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="u-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            aria-label="Search your agents"
          />
        </label>
        <button className="u-agent-new" onClick={onNew}>
          <span className="u-agent-plus" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          New agent
        </button>
        {shown.length === 0 ? (
          <div className="u-empty">
            <span className="u-empty-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" />
              </svg>
            </span>
            <h4>{library.agents.length === 0 ? "No agents yet" : "Nothing matches"}</h4>
            <p>
              {library.agents.length === 0
                ? "The one you are building is saved as you write it, and appears here."
                : "Try a different word."}
            </p>
          </div>
        ) : (
          <div className="u-agent-list">
            {groupByRecency(shown, now).map((group) => (
              <section className="u-agent-group" key={group.label}>
                <span className="u-label">{group.label}</span>
                {group.agents.map((agent) => (
                  <div className={`u-agent ${agent.id === currentId ? "on" : ""}`} key={agent.id}>
                    <button className="u-row-pick" onClick={() => onPick(agent)}>
                      <span className="u-mk" style={{ background: markColour(agent.name) }}>
                        {agent.name.trim().charAt(0).toUpperCase() || "A"}
                      </span>
                      <span className="u-agent-name">{agent.name}</span>
                    </button>
                    <span className="u-agent-end">
                      {agent.id === currentId ? (
                        <span className="u-agent-open">
                          <span className="u-dot" aria-hidden="true" />
                          Open
                        </span>
                      ) : (
                        <span className="u-agent-ago">{shortAgo(agent.updatedAt, now)}</span>
                      )}
                      <button
                        className="u-ico u-agent-del"
                        aria-label={`Delete ${agent.name}`}
                        data-tip="Delete this agent"
                        onClick={() => {
                          const conversations = history.entries.filter((entry) => entry.agentId === agent.id);
                          history.removeForAgent(agent.id);
                          permissions.reset(permissionScopeFor(agent.id, agent.source));
                          library.remove(agent.id);
                          setUndo({ agent, conversations });
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      {undo !== null && (
        <UndoToast
          message={`Deleted ${undo.agent.name}`}
          onAction={() => {
            library.save({
              id: undo.agent.id,
              name: undo.agent.name,
              description: undo.agent.description,
              source: undo.agent.source,
              origin: undo.agent.origin,
            });
            if (undo.conversations.length > 0) history.restore(undo.conversations);
            setUndo(null);
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
    </>
  );
}

export function whenAgo(at: number, now = Date.now()): string {
  const mins = Math.round((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days === 7) return "last week";
  return `${days} days ago`;
}

export function shortAgo(at: number, now = Date.now()): string {
  const mins = Math.floor(Math.max(0, now - at) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function groupByRecency<T extends { updatedAt: number }>(
  agents: T[],
  now = Date.now(),
): { label: "Today" | "Earlier"; agents: T[] }[] {
  const today = agents.filter((agent) => now - agent.updatedAt < DAY);
  const earlier = agents.filter((agent) => now - agent.updatedAt >= DAY);
  return [
    { label: "Today" as const, agents: today },
    { label: "Earlier" as const, agents: earlier },
  ].filter((group) => group.agents.length > 0);
}
