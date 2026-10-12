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

import type { AgentMetadata, ModelPort } from "@afm/engine";
import { stripCodeFence, buildAfmSource } from "./draft-format";

type DraftResult = { kind: "draft"; source: string } | { kind: "clarify"; questions: string[] };

export async function generateDraft(
  promptText: string,
  model: AgentMetadata["model"],
  final: boolean,
  resolveAuthoringModel: (model: AgentMetadata["model"]) => Promise<ModelPort>,
): Promise<DraftResult> {
  const modelPort = await resolveAuthoringModel(model);
  const provider = (model?.provider ?? "openai").toLowerCase();
  const modelName = model?.name ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o");
  const secretName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const fileSpec =
    "When you're ready to generate, reply with ONLY this - no YAML, no frontmatter, no code " +
    "fences, no commentary. The app builds the file's technical header (model, provider, " +
    "authentication, interface) itself from fixed values; you never write it and never " +
    "mention it:\n" +
    "NAME: <a short agent name>\n\n" +
    "# Role\n<1-2 sentences describing what the agent is>\n\n" +
    "# Instructions\n<clear, step-by-step instructions for what it should do>";
  const instruction = final
    ? "You write AFM agent files. The user has already answered your follow-up questions " +
      `below - do not ask any more questions, under any circumstances. ${fileSpec}\n\n` +
      `Request: ${promptText}`
    : "You write AFM agent files. First decide: is this request specific enough to write a " +
      "genuinely useful agent (clear purpose, tone, and what it should and shouldn't do)? " +
      "Only ask about the agent's purpose, behavior, tone, or content/domain needs - never " +
      "about the AI model, provider, or interface, since those are fixed by the app, not " +
      'something you or the user decide here. If something important is missing, reply with ' +
      'ONLY this JSON and nothing else: {"clarify": ["question 1", "question 2"]} - 1 to 3 ' +
      "short, concrete questions.\n" +
      `Otherwise, ${fileSpec}\n\n` +
      `Request: ${promptText}`;
  const controller = new AbortController();
  let text = "";
  for await (const event of modelPort.stream(
    { system: "", messages: [{ role: "user", content: instruction }], tools: [] },
    controller.signal,
  )) {
    if (event.type === "text-delta") text += event.text;
  }
  const cleaned = stripCodeFence(text);
  if (!final && cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned) as { clarify?: unknown };
      if (Array.isArray(parsed.clarify) && parsed.clarify.every((q) => typeof q === "string")) {
        return { kind: "clarify", questions: parsed.clarify };
      }
    } catch {
    }
  }
  return { kind: "draft", source: buildAfmSource(cleaned, provider, modelName, secretName) };
}
