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
import type { ChatMessage, ToolCall, ContentPart } from "@afm/engine";
import { splitFrontmatter } from "@afm/engine";
import { encodeInlineAfm } from "./load-paths";

function userContentOf(message: Extract<UiMessage, { kind: "user" }>): string | ContentPart[] {
  if (message.images === undefined || message.images.length === 0) return message.text;
  return [
    ...(message.text.trim() !== "" ? [{ type: "text" as const, text: message.text }] : []),
    ...message.images.map((image) => ({ type: "image" as const, data: image.data, mediaType: image.mediaType })),
  ];
}

// Rebuilds the conversation the agent had from the rows on screen, including tool calls and
// results, so a reopened chat can answer a follow-up about a tool's output. A tool row belongs to
// the assistant turn before it: rows are gathered onto that turn and flushed when the next user or
// assistant row begins.
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
      conversation.push({ role: "user", content: userContentOf(message) });
    } else if (message.kind === "assistant") {
      flush();
      assistantText = message.text;
    } else if (message.kind === "tool") {
      toolCalls.push({ id: message.callId, name: message.name, args: message.args });
      // A call still running when the chat was stored gets an empty result, since a tool call
      // without one is rejected.
      toolResults.push({ id: message.callId, content: message.result ?? "" });
    }
  }
  flush();
  return conversation;
}

export type ShareMethod = "inline" | "url";
export type ShareAccess = "run" | "edit";

/**
 * Share links over the one workspace route: "run" opens as a chat, "edit" with the file in front.
 * The inline form carries the agent in the fragment, which is never sent to a server; the url form
 * carries only the address of a hosted file.
 */
export function buildShareLink(
  origin: string,
  method: ShareMethod,
  access: ShareAccess,
  agentSource: string,
  fileUrl: string | null,
): string | null {
  const chatOnly = access === "run" ? "?view=chat" : "";
  if (method === "inline") {
    return `${origin}/${chatOnly}#afm=${encodeInlineAfm(agentSource)}`;
  }
  if (fileUrl === null || fileUrl === "") {
    return null;
  }
  const file = `file=${encodeURIComponent(fileUrl)}`;
  return `${origin}/?${access === "run" ? `view=chat&${file}` : file}`;
}

const CREDENTIAL_FIELDS = ["token", "password", "api_key", "client_secret", "refresh_token", "assertion", "signing_key"];
const REFERENCE = /^\s*\$\{[^}]+\}\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Credential fields holding a typed-in value rather than a `${env:NAME}` reference; a link that
 * carries the file carries these too.
 */
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
