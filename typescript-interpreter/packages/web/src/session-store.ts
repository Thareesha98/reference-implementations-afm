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

import type { UiMessage } from "./chat-state";
import type { ChatMessage, ToolCall } from "@afm/engine";
import { splitFrontmatter } from "@afm/engine";
import { encodeInlineAfm } from "./load-paths";
import { userContent } from "./message-content";

export function toSeededConversation(messages: UiMessage[]): ChatMessage[] {
  const conversation: ChatMessage[] = [];
  let assistantText: string | null = null;
  let toolCalls: ToolCall[] = [];
  let toolResults: { id: string; content: string }[] = [];

  function flush(): void {
    if (assistantText === null && toolCalls.length === 0) return;
    conversation.push(
      toolCalls.length > 0
        ? { role: "assistant", content: assistantText ?? "", toolCalls }
        : { role: "assistant", content: assistantText ?? "" },
    );
    for (const result of toolResults) {
      conversation.push({ role: "tool", toolCallId: result.id, content: result.content });
    }
    assistantText = null;
    toolCalls = [];
    toolResults = [];
  }

  for (const message of messages) {
    if (message.kind === "user") {
      flush();
      conversation.push({ role: "user", content: userContent(message.text, message.images) });
    } else if (message.kind === "assistant") {
      flush();
      assistantText = message.text;
    } else if (message.kind === "tool") {
      toolCalls.push({ id: message.callId, name: message.name, args: message.args });
      toolResults.push({ id: message.callId, content: message.result ?? "" });
    }
  }
  flush();
  return conversation;
}

export type ShareMethod = "inline" | "url";

export function buildShareLink(
  origin: string,
  method: ShareMethod,
  agentSource: string,
  fileUrl: string | null,
): string | null {
  if (method === "inline") {
    return `${origin}/?view=chat#afm=${encodeInlineAfm(agentSource)}`;
  }
  if (fileUrl === null || fileUrl === "") {
    return null;
  }
  return `${origin}/?view=chat&file=${encodeURIComponent(fileUrl)}`;
}

const CREDENTIAL_FIELDS = ["token", "password", "api_key", "client_secret", "refresh_token", "assertion", "signing_key"];
const REFERENCE = /^\s*\$\{[^}]+\}\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function literalCredentialFields(source: string): string[] {
  let frontmatter: Record<string, unknown> | null;
  try {
    frontmatter = splitFrontmatter(source).frontmatter;
  } catch {
    return [];
  }
  const model = isRecord(frontmatter?.model) ? frontmatter.model : {};
  const tools = isRecord(frontmatter?.tools) ? frontmatter.tools : {};
  const servers = Array.isArray(tools.mcp) ? tools.mcp : [];
  const blocks = [
    model.authentication,
    ...servers.map((server) => (isRecord(server) && isRecord(server.transport) ? server.transport.authentication : undefined)),
  ];

  const found = new Set<string>();
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    for (const field of CREDENTIAL_FIELDS) {
      const value = block[field];
      if (typeof value === "string" && value.trim() !== "" && !REFERENCE.test(value)) found.add(field);
    }
  }
  return [...found];
}
