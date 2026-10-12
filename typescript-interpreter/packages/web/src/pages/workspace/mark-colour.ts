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

export function markColour(name: string): string {
  const palette = ["#2B2B2B", "#0B6E4F", "#8E6210", "#7A50C8", "#AE3A2E", "#1E7A55"];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return palette[hash % palette.length] as string;
}

export function providerColour(provider: string): string {
  if (provider === "openai") return "#10A37F";
  if (provider === "anthropic") return "#C15F3C";
  return "var(--accent)";
}
