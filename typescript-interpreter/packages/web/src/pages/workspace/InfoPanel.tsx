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

import { useId, useState } from "react";
import type { AgentMetadata } from "@afm/engine";
import type { SavedAgent } from "../../agents-store";
import { AgentAvatar, iconUrlError } from "../../chat/AgentAvatar";
import { hostOf } from "../../load-paths";
import { whenAgo } from "./AgentPicker";
import { setFrontmatterValue } from "./agent-source-edit";
import { LicenseSelect } from "./LicenseSelect";
import { useAutosize } from "./use-autosize";

interface Props {
  content: string;
  metadata: AgentMetadata | null;
  saved: SavedAgent | undefined;
  onApply: (content: string) => void;
  onClose: () => void;
}

const KEYS = {
  name: "name",
  description: "description",
  icon: "icon_url",
  version: "version",
  authors: "authors",
  provider: "provider",
  license: "license",
};

type Field = keyof typeof KEYS;
type Draft = Record<Field, string>;

const FIELDS = Object.keys(KEYS) as Field[];
const MAX_DESCRIPTION_HEIGHT = 200;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function present(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function startingDraft(metadata: AgentMetadata | null): Draft {
  return {
    name: present(metadata?.name) ?? "",
    description: present(metadata?.description) ?? "",
    icon: present(metadata?.icon_url) ?? "",
    version: present(metadata?.version) ?? "",
    authors: present(metadata?.authors?.join(", ")) ?? "",
    provider: present(metadata?.provider?.name) ?? "",
    license: present(metadata?.license) ?? "",
  };
}

export function applyAbout(content: string, start: Draft, draft: Draft, providerUrl: string): string {
  let next = content;
  for (const field of FIELDS.filter((name) => draft[name].trim() !== start[name])) {
    const text = draft[field].trim();
    const value =
      field === "authors"
        ? text.split(",").map((author) => author.trim()).filter((author) => author !== "")
        : field === "provider"
          ? { name: text, url: providerUrl }
          : text;
    next = setFrontmatterValue(next, KEYS[field], value);
  }
  return next;
}

export function versionError(text: string): string | null {
  const version = text.trim();
  return version === "" || SEMVER.test(version) ? null : "Use MAJOR.MINOR.PATCH, like 1.0.0";
}

export function aboutRows(metadata: AgentMetadata | null): { field: Field; label: string; value: string | null }[] {
  const providerUrl = present(metadata?.provider?.url);
  return [
    { field: "version", label: "Version", value: present(metadata?.version) },
    { field: "authors", label: "Authors", value: present(metadata?.authors?.join(", ")) },
    { field: "provider", label: "Provider", value: present(metadata?.provider?.name) ?? (providerUrl === null ? null : hostOf(providerUrl)) },
    { field: "license", label: "License", value: present(metadata?.license) },
  ];
}

export function InfoPanel({ content, metadata, saved, onApply, onClose }: Props) {
  const [start] = useState(() => startingDraft(metadata));
  const [draft, setDraft] = useState(start);
  const [iconOpen, setIconOpen] = useState(false);
  const [iconText, setIconText] = useState(start.icon);
  const descriptionId = useId();
  const descriptionRef = useAutosize(draft.description, MAX_DESCRIPTION_HEIGHT);
  const readOnly = metadata === null;
  const edit = (field: Field, text: string) => setDraft({ ...draft, [field]: text });
  const versionProblem = draft.version.trim() === start.version ? null : versionError(draft.version);
  const iconProblem = iconText.trim() === "" ? null : iconUrlError(iconText);
  const canUseIcon = iconText.trim() !== "" && iconProblem === null;
  const dirty = FIELDS.some((field) => draft[field].trim() !== start[field]);

  function applyIcon() {
    edit("icon", iconText.trim());
    setIconOpen(false);
  }

  function removeIcon() {
    edit("icon", "");
    setIconText("");
    setIconOpen(false);
  }

  function save() {
    onApply(applyAbout(content, start, draft, metadata?.provider?.url ?? ""));
    onClose();
  }

  return (
    <>
      <div className="u-panel-body">
        <div className="u-group">
          <span className="u-label">About</span>

          <div className="u-info-id">
            <span className="u-info-avatar-wrap">
              <AgentAvatar className="u-info-avatar" name={draft.name} iconUrl={draft.icon} />
              <button
                className="u-info-edit"
                data-tip="Change icon"
                aria-label="Change icon"
                aria-expanded={iconOpen}
                disabled={readOnly}
                onClick={() => setIconOpen(!iconOpen)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
                </svg>
              </button>
            </span>
            <div className="u-info-id-fields">
              <input
                className="u-ghost name"
                value={draft.name}
                placeholder="Untitled agent"
                aria-label="Agent name"
                disabled={readOnly}
                onChange={(event) => edit("name", event.target.value)}
              />
            </div>
          </div>

          <div className="u-desc">
            <label className="u-label" htmlFor={descriptionId}>
              Description
            </label>
            <div className={`u-desc-box ${readOnly ? "is-off" : ""}`}>
              <textarea
                id={descriptionId}
                ref={descriptionRef}
                className="u-desc-field"
                rows={3}
                value={draft.description}
                placeholder="Say what this agent is for, in a sentence or two"
                aria-describedby={`${descriptionId}-hint`}
                disabled={readOnly}
                onChange={(event) => edit("description", event.target.value)}
              />
            </div>
            <p className="u-hint" id={`${descriptionId}-hint`}>
              Shown at the top of a new chat. Left empty, it is drawn from the role.
            </p>
          </div>

          {iconOpen && (
            <div className="u-info-icon">
              <span className="u-label">Icon link</span>
              <div className="u-info-icon-row">
                <input
                  className="u-ghost"
                  autoFocus
                  value={iconText}
                  placeholder="Paste an image link, https://…"
                  aria-label="Icon link"
                  onChange={(event) => setIconText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !canUseIcon) return;
                    event.preventDefault();
                    applyIcon();
                  }}
                />
                <button className="u-btn primary sm" disabled={!canUseIcon} onClick={applyIcon}>
                  Use
                </button>
              </div>
              {iconProblem !== null ? (
                <p className="u-info-error">{iconProblem}</p>
              ) : (
                <p className="u-hint">A square picture works best. It is saved in the file as icon_url.</p>
              )}
              {draft.icon !== "" && (
                <button className="u-btn quiet sm" onClick={removeIcon}>
                  Remove icon
                </button>
              )}
            </div>
          )}

          {aboutRows(metadata).map((row) => {
            const { field } = row;
            if (field === "license") {
              return (
                <div className="u-info-row edit" key={row.label}>
                  <span className="u-info-label">{row.label}</span>
                  <LicenseSelect value={draft.license} disabled={readOnly} onChange={(text) => edit("license", text)} />
                </div>
              );
            }
            const empty = field === "version" ? "0.0.0" : start[field] === "" ? (row.value ?? "Not set") : "Not set";
            return (
              <div key={row.label}>
                <label className="u-info-row edit">
                  <span className="u-info-label">{row.label}</span>
                  <input
                    className="u-ghost"
                    value={draft[field]}
                    placeholder={empty}
                    disabled={readOnly}
                    onChange={(event) => edit(field, event.target.value)}
                  />
                </label>
                {field === "version" && versionProblem !== null && <p className="u-info-error">{versionProblem}</p>}
              </div>
            );
          })}
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

      <div className="u-panel-foot end">
        <button className="u-btn ghost" onClick={onClose}>Cancel</button>
        <button className="u-btn primary" disabled={readOnly || !dirty || versionProblem !== null} onClick={save}>
          Save
        </button>
      </div>
    </>
  );
}
