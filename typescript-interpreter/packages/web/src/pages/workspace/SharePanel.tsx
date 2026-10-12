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
import type { AgentMetadata } from "@afm/engine";
import { buildableAgent } from "../../agent-validation";
import { normalizeAgentFileUrl } from "../../load-paths";
import { buildShareLink, literalCredentialFields } from "../../session-store";
import type { ShareMethod } from "../../session-store";
import { downloadAgentFile } from "../../download-agent-file";
import { useCopyFeedback } from "../../use-copy-feedback";

interface Props {
  agentSource: string;
}

const DELIVERY_OPTIONS = [
  { id: "inline", name: "In the link", sub: "Recommended for small agents" },
  { id: "url", name: "Hosted file", sub: "For larger agents you keep updated" },
] as const;

export function shareChecks(metadata: AgentMetadata | null): { label: string; done: boolean }[] {
  const filled = (text: string | undefined) => (text?.trim() ?? "") !== "";
  return [
    { label: "Description", done: filled(metadata?.description) },
    { label: "Icon", done: filled(metadata?.icon_url) },
    { label: "Version", done: filled(metadata?.version) },
    { label: "Authors", done: (metadata?.authors?.length ?? 0) > 0 },
    { label: "Provider", done: filled(metadata?.provider?.name) },
    { label: "License", done: filled(metadata?.license) },
  ];
}

export function SharePanel({ agentSource }: Props) {
  const [method, setMethod] = useState<ShareMethod>("url");
  const [fileUrl, setFileUrl] = useState("");
  const [tab, setTab] = useState<"link" | "file">("link");
  const { copied, copy } = useCopyFeedback(1500);

  const origin = window.location.origin;
  const built = buildableAgent(agentSource);
  const checks = shareChecks(built.ok ? built.metadata : null);
  const ready = checks.filter((check) => check.done).length;

  const normalized = fileUrl.trim() === "" ? null : normalizeAgentFileUrl(fileUrl);
  const rewritten = normalized !== null && normalized.ok && normalized.url !== fileUrl.trim();
  const fileKeys = literalCredentialFields(agentSource);
  const literalKeys = method === "inline" ? fileKeys : [];
  const link = buildShareLink(
    origin,
    method,
    agentSource,
    normalized !== null && normalized.ok ? normalized.url : null,
  );

  return (
    <div className="u-panel-body u-share">
      <div className="u-group">
        <div className="u-seg fill">
          {(["link", "file"] as const).map((id) => (
            <button key={id} className={tab === id ? "on" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {id === "link" ? "Link" : "File"}
            </button>
          ))}
        </div>
      </div>

      <div className="u-group">
        <div className="u-label-row">
          <span className="u-label">Ready to share</span>
          <div className="u-spacer" />
          <span className={`u-chip ${ready === checks.length ? "ok" : "warn"}`}>
            {ready} of {checks.length}
          </span>
        </div>
        <div className="u-todo">
          {checks.map((check) => (
            <span className={`u-todo-item ${check.done ? "on" : ""}`} key={check.label}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d={check.done ? "M4 12.5l5 5L20 6.5" : "M6 12h12"} />
              </svg>
              {check.label}
              <span className="visually-hidden">{check.done ? " added" : " not added"}</span>
            </span>
          ))}
        </div>
      </div>

      {tab === "link" ? (
        <>
          <div className="u-group">
            <span className="u-label">Delivery</span>
            <div className="u-seg fill">
              {DELIVERY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={method === option.id ? "on" : ""}
                  aria-pressed={method === option.id}
                  onClick={() => setMethod(option.id)}
                >
                  {option.name}
                </button>
              ))}
            </div>
            <p className="u-hint">{DELIVERY_OPTIONS.find((option) => option.id === method)?.sub}</p>
          </div>

          {method === "url" && (
            <div className="u-group">
              <span className="u-label">Public URL of your .afm.md</span>
              <input
                className="u-input mono"
                value={fileUrl}
                onChange={(event) => setFileUrl(event.target.value)}
                placeholder="https://…/agent.afm.md"
              />
              {rewritten && normalized !== null && normalized.ok && (
                <p className="u-hint">
                  Using the raw file URL: <code>{normalized.url}</code>
                </p>
              )}
            </div>
          )}

          <div className="u-group" style={{ marginBottom: 0 }}>
            <span className="u-label">Link</span>
            <div className="u-code">{link ?? "Add the file's address above to get a link."}</div>
            <button
              className="u-btn primary wide"
              style={{ marginTop: "8px" }}
              disabled={link === null}
              onClick={() => link !== null && copy(link)}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            {literalKeys.length === 0 ? (
              <p className="u-hint">Your API key is never included.</p>
            ) : (
              <p className="u-hint u-warn-note">
                This file has a key written into it ({literalKeys.join(", ")}), and the link carries the whole
                file. Replace it with a <code>{"${env:NAME}"}</code> reference first.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="u-group" style={{ marginBottom: 0 }}>
          <span className="u-label">Agent file</span>
          <p className="u-hint" style={{ marginTop: 0, marginBottom: "10px" }}>
            Everything in one file. Send it, edit it anywhere, or run it in another AFM runtime.
          </p>
          <button className="u-btn primary wide" onClick={() => downloadAgentFile(agentSource)}>
            Download .afm.md
          </button>
          {fileKeys.length === 0 ? (
            <p className="u-hint">Your API key is never included.</p>
          ) : (
            <p className="u-hint u-warn-note">
              This file has a key written into it ({fileKeys.join(", ")}). Replace it with a{" "}
              <code>{"${env:NAME}"}</code> reference before you send it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
