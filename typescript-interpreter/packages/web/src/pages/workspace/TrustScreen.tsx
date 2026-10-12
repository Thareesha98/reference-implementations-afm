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

import { DEFAULT_MAX_ITERATIONS, referencedSecretNames } from "@afm/engine";
import type { AgentMetadata } from "@afm/engine";
import { hostOf } from "../../load-paths";
import { shortModelLabel } from "./model-catalog";

interface Props {
  metadata: AgentMetadata;
  source: string;
  savedSecrets: string[];
  onRun: () => void;
  onOpenBuilder: () => void;
}

export function toolSummary(metadata: AgentMetadata): string {
  const servers = metadata.tools?.mcp ?? [];
  if (servers.length === 0) return "None";
  return servers
    .map((server) => {
      const allowed = server.tool_filter?.allow?.length;
      const host = server.transport.type === "http" ? ` (${hostOf(server.transport.url)})` : "";
      const count = allowed === undefined ? "" : ` · ${allowed} tool${allowed === 1 ? "" : "s"}`;
      return `${server.name}${host}${count}`;
    })
    .join(", ");
}

export function TrustScreen({ metadata, source, savedSecrets, onRun, onOpenBuilder }: Props) {
  const keys = referencedSecretNames(source);

  return (
    <div className="u-centre">
      <div className="u-trust">
        <span className="u-empty-ico" aria-hidden="true">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </span>
        <h4>{metadata.name ?? "Untitled agent"}</h4>
        <p>Someone shared this agent with you. Here is what the file sets up, before it runs.</p>

        <div className="u-declare">
          <div className="u-declare-row">
            <span className="u-declare-k">Model</span>
            <span>
              {shortModelLabel(metadata.model?.name ?? "-")}
              {metadata.model?.provider !== undefined && <span className="u-row-sub"> · {metadata.model.provider}</span>}
            </span>
          </div>
          <div className="u-declare-row">
            <span className="u-declare-k">Tool servers</span>
            <span>{toolSummary(metadata)}</span>
          </div>
          <div className="u-declare-row">
            <span className="u-declare-k">Needs from you</span>
            <span>
              {keys.length === 0 ? (
                "Nothing"
              ) : (
                keys.map((name) => (
                  <span key={name}>
                    <code>{name}</code>{" "}
                    <span className={`tag ${savedSecrets.includes(name) ? "ok" : ""}`}>
                      {savedSecrets.includes(name) ? "entered" : "not entered"}
                    </span>{" "}
                  </span>
                ))
              )}
            </span>
          </div>
          <div className="u-declare-row">
            <span className="u-declare-k">Step limit</span>
            <span>{metadata.max_iterations ?? DEFAULT_MAX_ITERATIONS} steps per answer</span>
          </div>
        </div>

        <p className="u-hint">
          Tools the file lists run without asking. Any other tool asks first, unless you allow it in this tab. A key you enter stays
          in memory for this tab unless you choose to save it on this device.
        </p>
        <div className="u-trust-actions">
          <button className="u-btn ghost" onClick={onOpenBuilder}>
            Open in builder
          </button>
          <button className="u-btn primary" onClick={onRun}>
            Run it
          </button>
        </div>
      </div>
    </div>
  );
}
