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

import type { AgentMetadata } from "@afm/engine";
import type { SavedAgent } from "../../agents-store";
import { agentInitial } from "../../chat/starters";
import { hostOf } from "../../load-paths";
import { whenAgo } from "./AgentPicker";

interface Props {
  metadata: AgentMetadata | null;
  saved: SavedAgent | undefined;
  onToggleFavorite: () => void;
}

function present(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The details the file gives about itself; a blank or missing one is null. */
export function aboutRows(metadata: AgentMetadata | null): { label: string; value: string | null }[] {
  const providerUrl = present(metadata?.provider?.url);
  return [
    { label: "Version", value: present(metadata?.version) },
    { label: "Authors", value: present(metadata?.authors?.join(", ")) },
    { label: "Provider", value: present(metadata?.provider?.name) ?? (providerUrl === null ? null : hostOf(providerUrl)) },
    { label: "License", value: present(metadata?.license) },
  ];
}

/** What the file says about itself and what this browser's library says about the file. */
export function InfoPanel({ metadata, saved, onToggleFavorite }: Props) {
  const description = present(metadata?.description);

  return (
    <div className="u-panel-body">
      <div className="u-group">
        <div className="u-label-row">
          <span className="u-label">About</span>
          <div className="u-spacer" />
          {saved !== undefined && (
            <button
              className={`u-ico tiny ${saved.favorite ? "on" : ""}`}
              title={saved.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-label={saved.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={saved.favorite}
              onClick={onToggleFavorite}
            >
              <svg viewBox="0 0 24 24" fill={saved.favorite ? "currentColor" : "none"} stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
              </svg>
            </button>
          )}
        </div>

        <div className="u-info-avatar-row">
          <span className="u-info-avatar" aria-hidden="true">
            {agentInitial(metadata?.name ?? "")}
          </span>
          <p className={description === null ? "u-info-placeholder" : "u-info-text"}>
            {description ?? "No description in the file yet."}
          </p>
        </div>

        {aboutRows(metadata).map((row) => (
          <div className="u-info-row" key={row.label}>
            <span className="u-info-label">{row.label}</span>
            <span className="u-info-value">{row.value ?? "Not set"}</span>
          </div>
        ))}
      </div>

      <div className="u-group" style={{ marginBottom: 0 }}>
        <span className="u-label">In this browser</span>
        {saved === undefined ? (
          <p className="u-info-placeholder">Not in your Agents list yet.</p>
        ) : (
          <>
            <div className="u-info-row bordered">
              <span className="u-info-label">Created</span>
              <span className="u-info-value mono">{new Date(saved.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="u-info-row bordered">
              <span className="u-info-label">Last edited</span>
              <span className="u-info-value mono">{whenAgo(saved.updatedAt)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
