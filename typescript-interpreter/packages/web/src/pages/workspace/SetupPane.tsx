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

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { markColour, providerColour } from "./mark-colour";
import { ProviderMark } from "./ProviderMark";
import { MODEL_ROW, summaryOf, type KeysState, type SetupRow } from "./setup-check";

/** Long enough to see the last row turn ready before the chat takes over. */
const AUTO_RUN_DELAY_MS = 500;

interface Props {
  rows: SetupRow[];
  keys: KeysState;
  provider: string;
  ready: boolean;
  onConfigure: (row: SetupRow) => void;
  onCheckAgain: () => void;
  onRetryKeys: () => void;
  onRun: () => void;
}

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Status({ row, onConfigure }: { row: SetupRow; onConfigure: () => void }) {
  if (row.state === "ready") {
    return (
      <span className="u-run-st ok">
        <Icon>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </Icon>
        Ready
      </span>
    );
  }
  if (row.state === "checking") {
    return (
      <span className="u-run-st">
        <span className="u-spinner" aria-hidden="true" />
        Checking
      </span>
    );
  }
  if (row.state === "needs" || row.state === "failed") {
    return (
      <button className="u-btn ghost sm" onClick={onConfigure}>
        Configure
      </button>
    );
  }
  return (
    <span className="u-run-st wait">
      <i />
      {row.state === "changed" ? "Not checked" : "Waiting"}
    </span>
  );
}

function rowTone(row: SetupRow): string {
  if (row.state === "changed") return "is-changed";
  if (row.state !== "needs" && row.state !== "failed") return "";
  return row.failure === "signin" || row.failure === "rejected" ? "is-bad" : "is-need";
}

function Keys({ state, onRetry }: { state: KeysState; onRetry: () => void }) {
  if (state === "none") return null;
  const declined = state === "declined";
  return (
    <div className={`u-run-keys ${declined ? "is-bad" : ""}`}>
      <span className="u-run-ico">
        <Icon>
          <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
          <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
          <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
          <path d="M2 12a10 10 0 0 1 18-6" />
          <path d="M2 16h.01" />
          <path d="M21.8 16c.2-2 .131-5.354 0-6" />
          <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
          <path d="M8.65 22c.21-.66.45-1.32.57-2" />
          <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
        </Icon>
      </span>
      <span className="u-run-t">
        <span className="u-run-name">
          {declined ? "Your device didn't confirm" : state === "opening" ? "Opening your saved keys" : "Saved keys"}
        </span>
        <span className="u-run-note">
          {declined ? "Nothing was opened." : state === "opening" ? "Your device is asking." : "Ready"}
        </span>
      </span>
      {declined ? (
        <button className="u-btn primary sm" onClick={onRetry}>
          Try again
        </button>
      ) : state === "opening" ? (
        <span className="u-run-st">
          <span className="u-spinner" aria-hidden="true" />
          Waiting
        </span>
      ) : (
        <span className="u-run-st ok">
          <Icon>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
          </Icon>
          Opened
        </span>
      )}
    </div>
  );
}

export function SetupPane({ rows, keys, provider, ready, onConfigure, onCheckAgain, onRetryKeys, onRun }: Props) {
  const run = useRef(onRun);
  run.current = onRun;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => run.current(), AUTO_RUN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const summary = summaryOf(rows, keys);
  const servers = rows.filter((row) => row.kind === "server");
  const busy = keys === "opening" || rows.some((row) => row.state === "checking");

  const renderRow = (row: SetupRow) => (
    <div className={`u-run-row ${rowTone(row)}`} key={row.id}>
      <span className="u-mk" style={{ background: row.kind === "model" ? providerColour(provider) : markColour(row.name) }}>
        {row.kind === "model" ? <ProviderMark provider={provider} size={14} /> : row.name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="u-run-t">
        <span className="u-run-name">{row.name}</span>
        <span className="u-run-note">{row.note}</span>
      </span>
      <Status row={row} onConfigure={() => onConfigure(row)} />
    </div>
  );

  return (
    <>
      <div className="u-panel-body">
        <div className="u-run-sum">
          <span className={`u-chip ${summary.tone}`}>{summary.chip}</span>
          <span>{summary.text}</span>
        </div>
        <Keys state={keys} onRetry={onRetryKeys} />
        <span className="u-label">Model</span>
        {rows.filter((row) => row.id === MODEL_ROW).map(renderRow)}
        {servers.length > 0 && (
          <>
            <span className="u-label u-run-gap">Tools · {servers.length}</span>
            {servers.map(renderRow)}
          </>
        )}
      </div>

      <div className="u-panel-foot">
        <button
          className={`u-btn ${rows.some((row) => row.state === "changed") ? "primary" : "ghost"}`}
          disabled={busy}
          onClick={onCheckAgain}
        >
          Check again
        </button>
        <div className="u-spacer" />
        <button className="u-btn primary" disabled={!ready} onClick={onRun}>
          <span className="u-play" aria-hidden="true" />
          Run
        </button>
      </div>
    </>
  );
}
