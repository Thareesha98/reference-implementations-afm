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

import { useEffect, useRef, useState } from "react";
import type { UiMessage } from "../chat-state";

type ToolMessage = Extract<UiMessage, { kind: "tool" }>;

/**
 * What the agent did, as a footnote: no tool or server name, only that it checked and how long it
 * took. The duration is measured here because the transcript carries none.
 */
export function ToolFootnote({ tool }: { tool: ToolMessage }) {
  const startedAt = useRef(Date.now());
  // A call already finished on mount came from a stored transcript and has no recorded duration, so
  // it gets no number.
  const watched = useRef(tool.status === "running");
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (tool.status === "running" || !watched.current) return;
    setElapsed((current) => current ?? Date.now() - startedAt.current);
  }, [tool.status]);

  if (tool.status === "running") {
    return (
      <span className="xc-live">
        <span className="xc-pulse" aria-hidden="true" />
        Looking that up…
      </span>
    );
  }

  if (tool.status === "failed") {
    return (
      <span className="xc-used is-bad">
        <span className="d" aria-hidden="true" />
        Couldn’t check that
      </span>
    );
  }

  return (
    <span className="xc-used">
      <span className="d" aria-hidden="true" />
      Looked it up
      {elapsed !== null && <span className="xc-meta">{(elapsed / 1000).toFixed(1)}s</span>}
    </span>
  );
}
