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

export interface AgentExample {
  title: string;
  description: string;
  icon: string;
  content: string;
}

function agent(name: string, role: string, instructions: string): string {
  return `---
name: ${name}
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
${role}

# Instructions
${instructions}
`;
}

export const EXAMPLES: AgentExample[] = [
  {
    title: "Trip planner",
    description: "Recommends one clear option instead of a list.",
    icon: "🗺",
    content: agent(
      "Trip Planner",
      "You are a well-travelled trip planner who gives specific, opinionated advice rather than lists of options.",
      [
        "- Recommend rather than enumerate. Say which one you would pick, and why.",
        "- Keep the first answer short enough to read in one go, then offer to go deeper.",
        "- Be concrete about times, prices and distances.",
      ].join("\n"),
    ),
  },
  {
    title: "Friendly chat",
    description: "A warm, concise conversational assistant.",
    icon: "💬",
    content: agent("Friendly Chat", "You are a warm, helpful assistant.", "Answer clearly and keep replies short."),
  },
  {
    title: "Math tutor",
    description: "Explains arithmetic step by step.",
    icon: "🧮",
    content: agent(
      "Math Tutor",
      "You are a patient math tutor.",
      "Show each step simply and check the final answer.",
    ),
  },
  {
    title: "Code explainer",
    description: "Explains snippets in plain English.",
    icon: "🧑‍💻",
    content: agent(
      "Code Explainer",
      "You explain code to beginners.",
      "Describe what the code does line by line, then summarise it in one sentence.",
    ),
  },
];
