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

import { findAgent } from "../../agents-store";
import { inlineAfmParam, decodeInlineAfm } from "../../load-paths";

export const EMPTY_TEMPLATE = `---
name: New Agent
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: \${env:OPENAI_API_KEY}
interfaces:
  - type: webchat
---

# Role

# Instructions
`;

export function initialContent(searchParams: URLSearchParams, hash: string, draftSource: string | undefined): string {
  if (draftSource !== undefined) return draftSource;
  const agentId = searchParams.get("agentId");
  if (agentId !== null) {
    const saved = findAgent(agentId);
    if (saved !== null) return saved.source;
  }
  const inline = inlineAfmParam(searchParams, hash);
  if (inline !== null) {
    try {
      return decodeInlineAfm(inline);
    } catch {
    }
  }
  return EMPTY_TEMPLATE;
}

export function identityFor(searchParams: URLSearchParams, hash: string, draftSource: string | undefined): string {
  if (draftSource !== undefined) return `draft:${draftSource}`;
  const file = searchParams.get("file");
  if (file !== null) return `file:${file}`;
  return searchParams.get("agentId") ?? inlineAfmParam(searchParams, hash) ?? "blank";
}
