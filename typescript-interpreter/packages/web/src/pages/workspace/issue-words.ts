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

/** Which part of the Build view a problem belongs to, so it is shown where it is fixed. */
export type IssueTarget = "role" | "instructions" | "model" | "tools" | "file";

export interface PlainIssue {
  /** What to do about it, in words for someone who has never seen YAML. */
  text: string;
  /** The original wording. */
  detail: string;
  target: IssueTarget;
}

/**
 * Turns a validator's wording into something a person can act on. Anything not recognised keeps its
 * original wording; a wrong friendly message is worse than an unfriendly true one.
 */
export function inPlainWords(issue: AfmIssue): PlainIssue {
  const raw = issue.message;
  const detail = raw;

  if (/#\s*Role/i.test(raw)) {
    return { text: "Tell the agent who it is.", detail, target: "role" };
  }
  if (/#\s*Instructions/i.test(raw)) {
    return { text: "Tell the agent how it should behave.", detail, target: "instructions" };
  }

  const unknown = /Unknown field '([^']+)'/.exec(raw);
  if (unknown !== null) {
    return { text: `There is a setting called "${unknown[1]}" that AFM does not know.`, detail, target: "file" };
  }

  const field = issue.field;
  if (field === "model" || field.startsWith("model.")) {
    if (/required/i.test(raw)) return { text: "Choose a model for it to think with.", detail, target: "model" };
    return { text: "Something in the model settings is not right.", detail, target: "model" };
  }
  if (field.startsWith("tools")) {
    return { text: "Something in the server settings is not right.", detail, target: "tools" };
  }

  const required = /`([^`]+)` is required/.exec(raw);
  if (required !== null) {
    return { text: `"${required[1]}" is missing from the settings at the top of the file.`, detail, target: "file" };
  }

  return { text: raw, detail, target: "file" };
}
