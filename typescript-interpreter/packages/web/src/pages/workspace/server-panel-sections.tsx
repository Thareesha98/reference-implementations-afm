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

import type { ToolInfo } from "../../protocol";
import { isSecretAuthField } from "./mcp-secret-fields";
import { envSecretName } from "./agent-source-edit";

interface AuthFieldsProps {
  fields: readonly { key: string; name: string; hint: string; placeholder: string }[];
  values: Record<string, string>;
  secretEdits: Record<string, string>;
  locked: (key: string) => boolean;
  saved: (key: string) => boolean;
  onValue: (key: string, value: string) => void;
  onSecretEdit: (key: string, value: string) => void;
  onUnlock: (name: string) => void;
}

// The per-method input rows. A secret field is masked and shows saved or locked chips; a plain
// field (a username, a URL) shows its value.
export function AuthFields({ fields, values, secretEdits, locked, saved, onValue, onSecretEdit, onUnlock }: AuthFieldsProps) {
  return (
    <>
      {fields.map((field) =>
        isSecretAuthField(field.key) ? (
          <label className="u-group" key={field.key}>
            <span className="u-label-row">
              <span className="u-label">{field.name}</span>
              {locked(field.key) ? (
                <span className="u-chip warn">
                  <span className="u-dot" aria-hidden="true" />
                  locked
                </span>
              ) : saved(field.key) ? (
                <span className="u-chip ok">
                  <span className="u-dot" aria-hidden="true" />
                  saved
                </span>
              ) : (
                <span className="u-row-meta">{field.hint}</span>
              )}
              {locked(field.key) ? (
                <button className="u-linkish" onClick={() => onUnlock(envSecretName(values[field.key] ?? ""))}>
                  Unlock
                </button>
              ) : (
                saved(field.key) && (
                  <button className="u-linkish" onClick={() => onSecretEdit(field.key, "")}>
                    Clear
                  </button>
                )
              )}
            </span>
            <input
              className="u-input mono"
              type="password"
              value={secretEdits[field.key] ?? ""}
              placeholder={locked(field.key) || saved(field.key) ? "•••••••••••••••••••••" : `paste the ${field.name}`}
              onChange={(event) => onSecretEdit(field.key, event.target.value)}
            />
          </label>
        ) : (
          <label className="u-group" key={field.key}>
            <span className="u-label-row">
              <span className="u-label">{field.name}</span>
              <span className="u-row-meta">{field.hint}</span>
            </span>
            <input
              className="u-input mono"
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) => onValue(field.key, event.target.value)}
            />
          </label>
        ),
      )}
    </>
  );
}

interface ServerToolsProps {
  url: string;
  probing: boolean;
  found: ToolInfo[] | null;
  error: string | null;
  allowed: string[];
  waiting: string;
  onToggle: (tool: string) => void;
  onToggleAll: () => void;
  onCheckAgain: () => void;
  showTip: (tool: ToolInfo, row: HTMLElement) => void;
  hideTip: () => void;
}

// The tool list a probe found, with a skeleton while probing and a hint before there is anything.
// Each tool is a checkbox the agent may use.
export function ServerTools({ url, probing, found, error, allowed, waiting, onToggle, onToggleAll, onCheckAgain, showTip, hideTip }: ServerToolsProps) {
  return (
    <div className="u-group grow">
      <div className="u-label-row">
        <span className="u-label">Tools</span>
        {probing && <span className="u-row-meta">looking…</span>}
        {found !== null && <span className="u-row-meta">{found.length} found</span>}
        <div className="u-spacer" />
        {found !== null && found.length > 0 && (
          <button className="u-linkish" onClick={onToggleAll}>
            {allowed.length === found.length ? "Clear" : "Select all"}
          </button>
        )}
        {url.trim() !== "" && !probing && (
          <button className="u-linkish" onClick={onCheckAgain}>
            Check again
          </button>
        )}
      </div>

      {error !== null && (
        <div className="repair">
          <p className="repair-what">{error}</p>
          <button className="u-btn ghost" onClick={onCheckAgain}>
            Try again
          </button>
        </div>
      )}

      {probing ? (
        <div className="skeleton-rows" aria-label="Looking for tools">
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row}>
              <span className="skeleton-box" />
              <span className="skeleton-line" style={{ width: `${64 - row * 14}%` }} />
            </div>
          ))}
        </div>
      ) : found === null ? (
        <p className="u-hint">{waiting}</p>
      ) : (
        <div className="u-rows scroll">
          {found.map((tool) => (
            <label className="u-row" key={tool.name} onMouseEnter={(event) => showTip(tool, event.currentTarget)} onMouseLeave={hideTip}>
              <input type="checkbox" checked={allowed.includes(tool.name)} onChange={() => onToggle(tool.name)} />
              <span className="u-row-name">{tool.name}</span>
              {tool.description !== undefined && tool.description.trim() !== "" && (
                <span className="u-row-meta" aria-hidden="true">
                  ?
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
