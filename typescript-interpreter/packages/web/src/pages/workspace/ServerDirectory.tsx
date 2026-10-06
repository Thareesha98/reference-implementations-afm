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
import { searchMcpRegistry, loadRecentServers, recordRecentServer } from "../../mcp-servers";
import type { DirectoryEntry } from "../../mcp-servers";
import { markColour } from "./mark-colour";

interface Props {
  /** Owned by the panel, which keeps it in the header that stays put while the list scrolls. */
  query: string;
  onConnect: (entry: DirectoryEntry) => void;
  onInfo: (entry: DirectoryEntry) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Three zones: the name and Info on top, the description across the full width, then the publisher
 * beside Connect. One line in a 336px panel wrapped the description every second word.
 */
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
        {/* Both kinds are verified by the registry; the weight says which kind, and the domain makes a third party under a familiar name obvious. */}
        <span className={`u-pub ${entry.publisher.kind}`} title={entry.id}>
          <span className="u-pub-tick" aria-hidden="true">
            ✓
          </span>
          {entry.publisher.label}
        </span>
        <button className="u-btn ghost sm" onClick={() => onConnect(entry)}>
          Connect
        </button>
      </div>
    </div>
  );
}

/**
 * The "pick from a list" half of Connect tools, backed by the official MCP Registry
 * (registry.modelcontextprotocol.io: CORS-open, no key). Only servers this runtime can reach are
 * shown; see mcp-servers.ts.
 */
export function ServerDirectory({ query, onConnect, onInfo }: Props) {
  const [results, setResults] = useState<DirectoryEntry[] | null>(null);
  const [searching, setSearching] = useState(true);
  const [failed, setFailed] = useState(false);
  // Read once, on mount; a server connected a moment ago belongs at the top the next time.
  const [recent] = useState(() => loadRecentServers());

  function connect(entry: DirectoryEntry) {
    recordRecentServer(entry);
    onConnect(entry);
  }

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    // Debounced so typing does not fire a request per keystroke.
    const timer = window.setTimeout(() => {
      void searchMcpRegistry(query, fetch).then((result) => {
        if (cancelled) return;
        setSearching(false);
        if (!result.ok) {
          setFailed(true);
          setResults(null);
          return;
        }
        setFailed(false);
        setResults(result.entries);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      {query.trim() === "" && recent.length > 0 && (
        <div className="u-group">
          <span className="u-label">Recently connected</span>
          <div className="u-rows">
            {recent.map((entry) => (
              <ServerRow entry={entry} onConnect={connect} onInfo={onInfo} key={entry.id} />
            ))}
          </div>
        </div>
      )}
      <div className="u-group grow">
        {searching ? (
          <div className="skeleton-rows" aria-label="Searching the directory">
            {[0, 1, 2].map((row) => (
              <div className="skeleton-row" key={row}>
                <span className="skeleton-box" />
                <span className="skeleton-line" style={{ width: `${64 - row * 14}%` }} />
              </div>
            ))}
          </div>
        ) : failed ? (
          <p className="u-hint">Couldn't reach the directory. You can still paste an address, on the Add by URL tab.</p>
        ) : results === null || results.length === 0 ? (
          <p className="u-hint">Nothing here matches that. You can paste the address instead, on the Add by URL tab.</p>
        ) : (
          <div className="u-rows scroll">
            {results.map((entry) => (
              <ServerRow entry={entry} onConnect={connect} onInfo={onInfo} key={entry.id} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
