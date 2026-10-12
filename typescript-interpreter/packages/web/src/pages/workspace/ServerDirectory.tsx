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

import { useMemo } from "react";
import { searchDirectory } from "../../mcp-servers";
import type { DirectoryEntry } from "../../mcp-directory";
import { markColour } from "./mark-colour";

interface Props {
  query: string;
  onConnect: (entry: DirectoryEntry) => void;
  onInfo: (entry: DirectoryEntry) => void;
}

function ServerRow({
  entry,
  onConnect,
  onInfo,
}: {
  entry: DirectoryEntry;
  onConnect: (entry: DirectoryEntry) => void;
  onInfo: (entry: DirectoryEntry) => void;
}) {
  return (
    <div className="u-srv-row">
      <div className="u-srv-head">
        <span className="u-mk" style={{ background: markColour(entry.id) }}>
          {entry.title.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="u-srv-title">{entry.title}</span>
        <button
          className="u-info-btn"
          onClick={() => onInfo(entry)}
          aria-label={`About ${entry.title}`}
          data-tip={`About ${entry.title}`}
        >
          i
        </button>
      </div>
      <p className="u-srv-desc">{entry.description}</p>
      <div className="u-srv-foot">
        <span className="u-pub" title={entry.url}>
          <span className="u-pub-tick" aria-hidden="true">
            ✓
          </span>
          {entry.publisher}
        </span>
        <button className="u-btn ghost sm" onClick={() => onConnect(entry)}>
          Connect
        </button>
      </div>
    </div>
  );
}

export function ServerDirectory({ query, onConnect, onInfo }: Props) {
  const results = useMemo(() => searchDirectory(query), [query]);

  return (
    <div className="u-group grow">
      {results.length === 0 ? (
        <p className="u-hint">Nothing here matches that. You can paste the address instead, on the Add by URL tab.</p>
      ) : (
        <div className="u-rows scroll">
          {results.map((entry) => (
            <ServerRow entry={entry} onConnect={onConnect} onInfo={onInfo} key={entry.id} />
          ))}
        </div>
      )}
    </div>
  );
}
