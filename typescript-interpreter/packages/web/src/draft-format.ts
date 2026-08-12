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

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:[a-zA-Z]*\n)?([\s\S]*?)```$/.exec(trimmed);
  return fenced !== null ? fenced[1]!.trim() : trimmed;
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function extractNameAndBody(raw: string): { name: string; body: string } {
  const nameMatch = /^NAME:\s*(.+)$/m.exec(raw);
  const name = nameMatch?.[1]?.trim() || "Untitled agent";
  const roleIndex = raw.search(/^#{1,6}\s*Role\b/m);
  const body = roleIndex === -1 ? raw.trim() : raw.slice(roleIndex).trim();
  return { name, body };
}

export function buildAfmSource(rawText: string, provider: string, modelName: string, secretName: string): string {
  const { name, body } = extractNameAndBody(stripCodeFence(rawText));
  const frontmatter = [
    "---",
    `name: ${yamlQuote(name)}`,
    "model:",
    `  provider: ${provider}`,
    `  name: ${modelName}`,
    "  authentication:",
    "    type: api-key",
    `    api_key: "\${env:${secretName}}"`,
    "interfaces:",
    "  - type: webchat",
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${body}\n`;
}
