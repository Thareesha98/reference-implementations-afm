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
import type { ToolInfo } from "../../protocol";

interface Props {
  tools: ToolInfo[];
  /** Server URL to the name the file gives it. */
  nameByUrl: Map<string, string>;
  onConfirm: (allowedByServer: Map<string, string[]>) => void;
}

/** The design's own tick, so a row of tools reads as one control. */
function Check({ on, some = false }: { on: boolean; some?: boolean }) {
  return (
    <span className={`u-check ${on || some ? "on" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"
        strokeLinejoin="round">
        <path d={some ? "M5 12h14" : "M4 12.5l5 5L20 6.5"} />
      </svg>
    </span>
  );
}

/**
 * Everything the agent's servers offer, grouped by server and ticked by default. Unticking
 * narrows the agent down; the choice is written to the file as `tool_filter`.
 */
export function ToolStep({ tools, nameByUrl, onConfirm }: Props) {
  const fromServers = tools.filter((tool) => tool.serverId !== undefined);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(fromServers.map((tool) => tool.name)));

  const byServer = new Map<string, ToolInfo[]>();
  for (const tool of fromServers) {
    const list = byServer.get(tool.serverId!) ?? [];
    list.push(tool);
    byServer.set(tool.serverId!, list);
  }

  function toggle(name: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleServer(server: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      for (const tool of byServer.get(server) ?? []) {
        if (on) next.add(tool.name);
        else next.delete(tool.name);
      }
      return next;
    });
  }

  function confirm() {
    const allowed = new Map<string, string[]>();
    for (const [server, list] of byServer) {
      allowed.set(
        server,
        list.filter((tool) => chosen.has(tool.name)).map((tool) => tool.name),
      );
    }
    onConfirm(allowed);
  }

  return (
    <div className="u-setup-card u-tool-step">
      <h3 className="u-setup-title">Which tools may this agent use?</h3>
      <p className="u-setup-note">
        Everything is on. Turn off anything you would rather it could not reach - you can change this
        later in the file.
      </p>

      <div className="u-rows scroll">
        {[...byServer].map(([server, list]) => {
          const on = list.filter((tool) => chosen.has(tool.name)).length;
          return (
            <div key={server}>
              <button className="u-row" onClick={() => toggleServer(server, on !== list.length)}>
                <Check on={on === list.length} some={on > 0 && on < list.length} />
                <span className="u-row-name">{nameByUrl.get(server) ?? server}</span>
                <span className="u-row-meta">
                  {on} of {list.length}
                </span>
              </button>
              {list.map((tool) => (
                <button className="u-row is-nested" key={tool.name} onClick={() => toggle(tool.name)}>
                  <Check on={chosen.has(tool.name)} />
                  <span className="u-row-name mono">{tool.name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <button className="u-btn primary wide" onClick={confirm}>
        Continue with {chosen.size} tool{chosen.size === 1 ? "" : "s"}
      </button>
    </div>
  );
}
