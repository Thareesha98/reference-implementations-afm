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

import type { ReactNode } from "react";
import type { SidePanel } from "./workspace-view";

interface Props {
  agentName: string;
  saved: boolean;
  saveFailed: boolean;
  canAct: boolean;
  open: SidePanel | null;
  onToggle: (panel: SidePanel) => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  canRun: boolean;
  running: boolean;
  onRun: () => void;
  onToggleTheme: () => void;
  dark: boolean;
}

function Ico({
  children,
  label,
  on = false,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  on?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`u-ico ${on ? "on" : ""}`}
      data-tip={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function WorkspaceBar({
  agentName,
  saved,
  saveFailed,
  canAct,
  open,
  onToggle,
  agentsOpen,
  onToggleAgents,
  canRun,
  running,
  onRun,
  onToggleTheme,
  dark,
}: Props) {
  return (
    <div className="u-bar">
      <span className="u-brand">AFM</span>
      <span className="u-sep" aria-hidden="true" />
      <button className="u-agentname" onClick={onToggleAgents} aria-expanded={agentsOpen}>
        {agentName} <span className="u-caret" aria-hidden="true" />
      </button>
      <span className={`u-saved ${saveFailed ? "is-failed" : ""}`}>
        {saveFailed ? "Couldn’t save" : saved ? "Saved" : "Saving…"}
      </span>

      <span className="u-bar-right">
        {(!running || canRun) && (
          <>
            <button className="u-btn primary" onClick={onRun} disabled={!canRun} title="Start the agent with this file">
              <span className="u-play" aria-hidden="true" />
              {running ? "Re-run" : "Run"}
            </button>
            <span className="u-sep" aria-hidden="true" />
          </>
        )}
        <Ico label="Conversation" on={open === "chat"} onClick={() => onToggle("chat")}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </Ico>
        <Ico label="Share this agent" on={open === "share"} disabled={!canAct} onClick={() => onToggle("share")}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </Ico>
        <Ico label="Settings" on={open === "settings"} onClick={() => onToggle("settings")}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5v.2a2 2 0 11-4 0V21a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.7 9a1.7 1.7 0 00-.4-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1h.2a2 2 0 110 4H21a1.7 1.7 0 00-1.6 1z" />
        </Ico>
        <Ico label="About this agent" on={open === "info"} onClick={() => onToggle("info")}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </Ico>
        <Ico label={dark ? "Switch to light" : "Switch to dark"} onClick={onToggleTheme}>
          {dark ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
            </>
          ) : (
            <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" />
          )}
        </Ico>
      </span>
    </div>
  );
}
