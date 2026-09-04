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

import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  /** Chat only: hands the conversation the whole window, and back. */
  expanded?: boolean;
  onExpand?: () => void;
  /**
   * Stacked over the conversation rather than replacing it, so the chat keeps its scroll position
   * and half-typed message.
   */
  over?: boolean;
  /** The panel supplies its own body and foot. */
  flush?: boolean;
  /** No title bar: the two controls float over the content. */
  bare?: boolean;
  children: ReactNode;
}

function Ico({ path, label, onClick }: { path: string; label: string; onClick: () => void }) {
  return (
    <button className="u-ico" onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

const EXPAND = "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7";
const COLLAPSE = "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7";
const CLOSE = "M18 6L6 18M6 6l12 12";

/** One surface in the side window: what it is, a way out, and the body. */
export function SidePane({ title, onClose, expanded, onExpand, over = false, flush = false, bare = false, children }: Props) {
  return (
    <section className={`u-panel ${over ? "is-over" : ""} ${bare ? "is-bare" : ""}`} aria-label={title}>
      <div className="u-panel-head">
        {!bare && <span className="u-panel-title">{title}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: "2px" }}>
          {onExpand !== undefined && (
            <Ico
              path={expanded === true ? COLLAPSE : EXPAND}
              label={expanded === true ? "Show the builder again" : "Give the conversation the whole window"}
              onClick={onExpand}
            />
          )}
          <Ico path={CLOSE} label="Close" onClick={onClose} />
        </span>
      </div>
      {flush ? children : <div className="u-panel-body">{children}</div>}
    </section>
  );
}
