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
import { buildableAgent } from "../../agent-validation";
import { usePermissionsLedger } from "../../permissions/PermissionsLedgerContext";
import { permissionScopeFor } from "../../permissions-store";
import { markColour } from "./mark-colour";
import type { HistoryEntry } from "../../history-store";
import type { SavedAgent } from "../../agents-store";

interface Props {
  currentId: string | null;
  onPick: (agent: SavedAgent) => void;
  onNew: () => void;
}

/** Agents live behind their name in the top strip so the editor keeps the whole left panel. */
export function AgentPicker({ currentId, onPick, onNew }: Props) {
  const library = useAgentsLibrary();
  const history = useHistory();
  const permissions = usePermissionsLedger();
  // What was just deleted, kept whole so it can be restored. Deleting is instant and undo is a
  // button, not a dialog.
  const [undo, setUndo] = useState<{ agent: SavedAgent; conversations: HistoryEntry[] } | null>(null);
  const [query, setQuery] = useState("");

  const shown = library.agents.filter((agent) =>
    query.trim() === "" ? true : agent.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <div className="u-panel-body">
        <div className="u-group grow">
          <input
            className="u-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search your agents"
            style={{ marginBottom: "12px" }}
          />
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
            <div className="u-rows scroll">
              {shown.map((agent) => (
                <div className={`u-row ${agent.id === currentId ? "on" : ""}`} key={agent.id}>
                  <button className="u-row-pick" onClick={() => onPick(agent)}>
                    <span className="u-mk" style={{ background: markColour(agent.name) }}>
                      {agent.name.trim().charAt(0).toUpperCase() || "A"}
                    </span>
                    <span className="u-row-name">
                      {agent.name}
                      <span className="u-row-sub" style={{ display: "block" }}>
                        {toolCount(agent.source)} · {whenAgo(agent.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    className="u-ico"
                    aria-label={`Delete ${agent.name}`}
                    title="Delete this agent"
                    onClick={() => {
                      // The conversation belongs to the agent: it goes with it and returns with it.
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="u-panel-foot">
        <button className="u-btn ghost wide" onClick={onNew}>
          New agent
        </button>
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

/** How many tools the file lets it use, without the agent having run. */
function toolCount(source: string): string {
  const preview = buildableAgent(source);
  const servers = preview.ok ? (preview.metadata.tools?.mcp ?? []) : [];
  if (servers.length === 0) return "No tools";
  let total = 0;
  for (const server of servers) {
    const allowed = server.tool_filter?.allow?.length;
    // A server without a chosen tool list makes the count a guess, so servers are counted instead.
    if (allowed === undefined) return `${servers.length} server${servers.length === 1 ? "" : "s"}`;
    total += allowed;
  }
  return `${total} tool${total === 1 ? "" : "s"}`;
}

/** Plain words for how long ago. */
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
