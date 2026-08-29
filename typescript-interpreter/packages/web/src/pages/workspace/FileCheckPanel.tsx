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

import type { AfmIssue } from "../../agent-validation";
import { inPlainWords } from "./issue-words";
import type { IssueTarget } from "./issue-words";

/** What pressing the fix opens. */
const FIX_LABEL: Record<IssueTarget, string> = {
  role: "Write it",
  instructions: "Write them",
  model: "Choose a model",
  tools: "Open tools",
  file: "Open the file",
};

interface Props {
  issues: AfmIssue[];
  /**
   * Say it in words rather than the file's terms: true in Build, false in Raw where the exact
   * wording and line matter.
   */
  plain?: boolean;
  /** Given a place to go, each problem carries a way to fix it. */
  onFix?: (target: IssueTarget) => void;
}

export function FileCheckPanel({ issues, plain = false, onFix }: Props) {
  if (issues.length === 0) return null;

  return (
    <div className="u-issues">
      {issues.map((issue, index) => {
        const said = inPlainWords(issue);
        const where = [issue.line === null ? null : `line ${issue.line}`, issue.field === "" ? null : issue.field]
          .filter((part) => part !== null)
          .join(" · ");
        return (
          <div className="u-issue" key={index}>
            <span className={`u-issue-dot ${issue.severity === "error" ? "bad" : "warn"}`} aria-hidden="true" />
            <span className="u-issue-body">
              <b>{plain ? said.text : issue.message}</b>
              {plain && said.text !== said.detail && ` ${said.detail}`}
              {where !== "" && <span className="u-issue-where">{where}</span>}
            </span>
            {onFix !== undefined && (
              <button className="u-btn ghost sm" onClick={() => onFix(said.target)}>
                {FIX_LABEL[said.target]}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
