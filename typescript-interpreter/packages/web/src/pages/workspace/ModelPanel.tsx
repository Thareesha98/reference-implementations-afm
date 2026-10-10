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
import { MODEL_PROVIDERS, findProvider } from "./model-catalog";
import type { ProviderOption } from "./model-catalog";
import { getModelField, setModelField, setModelApiKey, getModelApiKey, envSecretName } from "./agent-source-edit";
import { KeepOnDevice } from "./KeepOnDevice";
import type { Issue } from "./setup-check";

interface Props {
  content: string;
  /** Names the agent can already use, in memory or sealed behind a passkey. */
  savedSecrets: string[];
  /** Of those, the ones sealed on disk, which survive a reload. */
  passkeySecrets: string[];
  onApply: (content: string) => void;
  /** What Setup found wrong with the model, said in the window it sends the user to. */
  issue: Issue | null;
  onSaveKey: (name: string, value: string, keep: boolean) => Promise<boolean>;
  /** Present when the window was opened from Setup, which it returns to. */
  onBack?: () => void;
  onClose: () => void;
}

/**
 * Who provides the model, which model, and the key that unlocks it. Held as a draft and written on
 * Save, so half-finished edits never reach the file.
 */
export function ModelPanel({ content, savedSecrets, passkeySecrets, issue, onApply, onSaveKey, onBack, onClose }: Props) {
  const fileProvider = getModelField(content, "provider");

  const [provider, setProvider] = useState(findProvider(fileProvider) !== undefined ? fileProvider : "");

  const [model, setModel] = useState(getModelField(content, "name"));
  const [key, setKey] = useState("");
  const [keep, setKeep] = useState(false);

  const known = findProvider(provider);
  // The name the file already points at wins while the provider is unchanged; looking up the
  // catalogue's name instead would report a saved key as missing.
  const fileSecretName = envSecretName(getModelApiKey(content));
  const secretName =
    provider === fileProvider && fileSecretName !== "" ? fileSecretName : (known?.secretName ?? "");
  const saved = savedSecrets.includes(secretName);
  const sealed = passkeySecrets.includes(secretName);
  const rejected = saved && issue?.kind === "rejected";

  function pickProvider(option: ProviderOption) {
    setProvider(option.id);
    const first = option.models[0]?.id;
    if (first !== undefined) setModel(first);
  }

  const canSave = known !== undefined && model.trim() !== "";

  function save() {
    if (!canSave) return;
    let next = setModelField(content, "provider", provider);
    next = setModelField(next, "name", model.trim());
    next = setModelApiKey(next, `\${env:${secretName}}`);
    if (key.trim() !== "") void onSaveKey(secretName, key.trim(), keep);
    onApply(next);
    onClose();
  }

  // The title and the way out belong to the side window that holds this panel.
  return (
    <>
      <div className="u-panel-body">
        {onBack !== undefined && (
          <button className="u-detail-back is-near" onClick={onBack}>
            ← Back to Setup
          </button>
        )}
        <div className="u-group">
          <span className="u-label">Provider</span>
          <div className="u-pills">
            {MODEL_PROVIDERS.map((option) => (
              <button
                key={option.id}
                className={`u-pill-btn ${provider === option.id ? "on" : ""}`}
                onClick={() => pickProvider(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {known === undefined ? (
          fileProvider !== "" && (
            <p className="u-hint">
              This file names <code>{fileProvider}</code>, which can&apos;t run in the browser. Choose a
              provider above.
            </p>
          )
        ) : (
          <>
            <div className="u-group">
              <span className="u-label">Model</span>
              <div className="u-rows">
                {known.models.map((option) => (
                  <button
                    key={option.id}
                    className={`u-row ${model === option.id ? "on" : ""}`}
                    onClick={() => setModel(option.id)}
                  >
                    <span className={`u-radio ${model === option.id ? "on" : ""}`} />
                    <span className="u-row-name">
                      {option.label}
                      {option.note !== undefined && <span className="u-row-sub"> · {option.note}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="u-group">
              <div className="u-label-row">
                <span className="u-label">API key</span>
                <span className={`u-chip ${rejected ? "bad" : saved ? "ok" : "warn"}`}>
                  <span className="u-dot" aria-hidden="true" />
                  {rejected ? "not accepted" : sealed ? "saved on this device" : saved ? "entered this session" : "not entered yet"}
                </span>
              </div>
              <input
                className="u-input"
                type="password"
                value={key}
                placeholder={saved ? "•••••••••••••••••••••" : `paste your ${known.label} key`}
                onChange={(event) => setKey(event.target.value)}
              />
              {(!saved || key.trim() !== "") && <KeepOnDevice keep={keep} onChange={setKeep} />}
              {issue !== null && !rejected && <p className="u-hint u-warn-note">{issue.text}</p>}
            </div>
          </>
        )}
      </div>

      <div className="u-panel-foot">
        <button className="u-btn ghost" onClick={onClose}>Cancel</button>
        <button className="u-btn primary" disabled={!canSave} onClick={save}>Save</button>
      </div>
    </>
  );
}
