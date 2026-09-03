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

import { useEffect, useState } from "react";
import { fetchServerDetail } from "../../mcp-servers";
import type { DirectoryEntry } from "../../mcp-servers";
import { markColour } from "./mark-colour";
import { hostOf } from "../../load-paths";

interface Props {
  entry: DirectoryEntry;
  onBack: () => void;
  onConnect: (entry: DirectoryEntry) => void;
}

/** Absent fields are left out rather than shown blank; most registry records are thin. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="u-fact">
      <span className="u-fact-k">{label}</span>
      <span className="u-fact-v">{children}</span>
    </div>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A "recently connected" row may come from an older version and lack newer fields. Re-read it from
 * the registry and show whichever copy knows more: the stored one renders at once, the fresh one
 * fills in the rest.
 */
function useFreshest(stored: DirectoryEntry): DirectoryEntry {
  const [fresh, setFresh] = useState<DirectoryEntry | null>(null);
  const stale = stored.updatedAt === undefined && stored.version === undefined;

  useEffect(() => {
    setFresh(null);
    if (!stale) return;
    let live = true;
    void fetchServerDetail(stored.id, fetch)
      .then((found) => {
        if (live && found !== null) setFresh(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [stored.id, stale]);

  return fresh ?? stored;
}

/**
 * What the registry knows about one server, read before connecting it. The publisher leads: every
 * record has one, and it answers whether "Notion" is from Notion or from someone relaying to it.
 */
export function ServerDetail({ entry: stored, onBack, onConnect }: Props) {
  const entry = useFreshest(stored);
  const { publisher } = entry;
  const secret = entry.headers.find((header) => header.isSecret) ?? entry.headers[0];

  return (
    <>
      <div className="u-panel-body panel-slide-in">
        <button className="u-detail-back" onClick={onBack}>
          ← Back to directory
        </button>

        <div className="u-detail-hero">
          <span className="u-mk lg" style={{ background: markColour(entry.id) }}>
            {entry.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="u-detail-id">
            <span className="u-detail-name">{entry.title}</span>
            <span className="u-detail-ns">{entry.id}</span>
          </span>
        </div>

        <p className="u-detail-desc">{entry.description}</p>

        <div className="u-detail-chips">
          {publisher.kind === "domain" ? (
            <span className="u-chip ok">
              <span className="u-dot" aria-hidden="true" />
              Publisher verified
            </span>
          ) : (
            <span className="u-chip neutral">
              <span className="u-dot" aria-hidden="true" />
              GitHub account
            </span>
          )}
          {entry.needsKey && <span className="u-chip warn">Needs a key</span>}
          {entry.status === "deprecated" && <span className="u-chip warn">Deprecated</span>}
          {entry.version !== undefined && <span className="u-chip neutral">v{entry.version}</span>}
        </div>

        <Fact label="Publisher">
          <b>{publisher.label}</b>
          {publisher.kind === "domain"
            ? " - the registry checked this domain before allowing the name."
            : " - a GitHub account the registry checked, so an individual rather than a company."}
        </Fact>

        <Fact label="Connects to">
          <span className="mono">{entry.url}</span>
        </Fact>

        {secret !== undefined ? (
          <Fact label="Asks for">
            <span className="mono">{secret.name}</span>
            {secret.isSecret ? " header, stored as a secret" : " header"}
            {secret.description !== undefined && ` - ${secret.description}`}
          </Fact>
        ) : (
          // No declared credential means one of two things and the registry does not say which.
          // Claiming "OAuth" would be a guess, so this states what will happen.
          <Fact label="Sign-in">
            Nothing declared. If {hostOf(entry.url)} asks you to sign in, AFM shows that step when
            you connect - you sign in with the provider, and AFM never sees your password.
          </Fact>
        )}

        {entry.updatedAt !== undefined && (
          <Fact label="Updated">
            {shortDate(entry.updatedAt)}
            {entry.status !== undefined && ` · ${entry.status} in the registry`}
          </Fact>
        )}

        {(entry.websiteUrl !== undefined || entry.repositoryUrl !== undefined) && (
          <Fact label="Links">
            {entry.websiteUrl !== undefined && (
              <a className="u-linkish" href={entry.websiteUrl} target="_blank" rel="noreferrer noopener">
                Website
              </a>
            )}
            {entry.websiteUrl !== undefined && entry.repositoryUrl !== undefined && " · "}
            {entry.repositoryUrl !== undefined && (
              <a className="u-linkish" href={entry.repositoryUrl} target="_blank" rel="noreferrer noopener">
                Repository
              </a>
            )}
          </Fact>
        )}

        <Fact label="Every tool">asks you before it runs, each time it is called.</Fact>
      </div>

      <div className="u-panel-foot">
        <button className="u-btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="u-btn primary" onClick={() => onConnect(entry)}>
          Connect
        </button>
      </div>
    </>
  );
}
