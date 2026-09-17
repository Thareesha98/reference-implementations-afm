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
import { normalizeAgentFileUrl } from "../../load-paths";
import { buildShareLink, literalCredentialFields } from "../../session-store";
import type { ShareAccess, ShareMethod } from "../../session-store";
import { downloadAgentFile } from "../../download-agent-file";
import { useCopyFeedback } from "../../use-copy-feedback";

interface Props {
  agentSource: string;
}

/** The two ways to hand an agent to someone, in a panel under the button. */
export function SharePanel({ agentSource }: Props) {
  const [method, setMethod] = useState<ShareMethod>("url");
  const [access, setAccess] = useState<ShareAccess>("run");
  const [fileUrl, setFileUrl] = useState("");
  const { copied, copy } = useCopyFeedback(1500);

  const origin = window.location.origin;

  const normalized = fileUrl.trim() === "" ? null : normalizeAgentFileUrl(fileUrl);
  const rewritten = normalized !== null && normalized.ok && normalized.url !== fileUrl.trim();
  const literalKeys = method === "inline" ? literalCredentialFields(agentSource) : [];
  const link = buildShareLink(
    origin,
    method,
    access,
    agentSource,
    normalized !== null && normalized.ok ? normalized.url : null,
  );

  const rows = (
    label: string,
    options: { id: string; name: string; sub: string }[],
    value: string,
    onPick: (id: string) => void,
  ) => (
    <div className="u-group">
      <span className="u-label">{label}</span>
      <div className="u-rows">
        {options.map((option) => (
          <button
            key={option.id}
            className={`u-row ${value === option.id ? "on" : ""}`}
            onClick={() => onPick(option.id)}
          >
            <span className={`u-radio ${value === option.id ? "on" : ""}`} />
            <span className="u-row-name">
              {option.name}
              <span className="u-row-sub" style={{ display: "block" }}>
                {option.sub}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="u-panel-body">
        {rows(
          "Access",
          [
            { id: "run", name: "Run only", sub: "Opens as a conversation" },
            { id: "edit", name: "Edit and run", sub: "Opens with the file in the builder" },
          ],
          access,
          (id) => setAccess(id as ShareAccess),
        )}
        {rows(
          "Delivery",
          [
            { id: "inline", name: "File contained in the link", sub: "Recommended for small agents" },
            { id: "url", name: "Link to a hosted file", sub: "For larger agents you keep updated" },
          ],
          method,
          (id) => setMethod(id as ShareMethod),
        )}

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
      </div>

      <div className="u-panel-foot">
        <button className="u-btn ghost sm" onClick={() => downloadAgentFile(agentSource)}>
          Download .afm.md
        </button>
      </div>
    </>
  );
}
