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
import type { UiMessage, AgentStatus } from "../chat-state";
import type { LoadStep } from "../protocol";
import { Message } from "./Message";
import { ToolFootnote } from "./ToolFootnote";
import { ThreadHead } from "./ThreadHead";
import { EmptyState } from "./EmptyState";
import { attachedFilesOf, attachedFileKey, attachmentBadge, describeAttachment } from "./attachment";

interface Props {
  messages: UiMessage[];
  streaming: boolean;
  status: AgentStatus;
  agentName: string;
  loadSteps: LoadStep[];
  notReady: string | null;
  onRetry: () => void;
  onRegenerate: () => void;
  onDetachFile?: (messageId: number, key: string) => void;
  description?: string;
  role?: string;
  /** Only offered before the conversation starts. */
  onAsk?: (question: string) => void;
  onReplaceKey?: () => void;
}

type ToolMessage = Extract<UiMessage, { kind: "tool" }>;

function lastIndexOfKind(messages: UiMessage[], kind: UiMessage["kind"]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.kind === kind) return i;
  }
  return -1;
}

/** Groups each answer with the tool calls behind it, drawn under the answer as a footnote. */
function toolsBeforeAnswers(messages: UiMessage[]): Map<number, ToolMessage[]> {
  const attached = new Map<number, ToolMessage[]>();
  let pending: ToolMessage[] = [];
  for (const message of messages) {
    if (message.kind === "tool") {
      pending.push(message);
      continue;
    }
    if (message.kind === "assistant" && pending.length > 0) {
      attached.set(message.id, pending);
      pending = [];
    }
    if (message.kind === "user") pending = [];
  }
  return attached;
}

export function MessageList(props: Props) {
  const { messages, streaming, status, agentName, loadSteps, notReady, onRetry, onRegenerate, onDetachFile,
    description, role, onAsk, onReplaceKey } = props;
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (el === null) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  if (messages.length === 0) {
    return (
      <div className="xc-wrap mid" ref={scrollRef}>
        <EmptyState
          status={status}
          agentName={agentName}
          loadSteps={loadSteps}
          notReady={notReady}
          onRetry={onRetry}
          description={description}
          role={role}
          onAsk={onAsk}
          onReplaceKey={onReplaceKey}
        />
      </div>
    );
  }

  const lastIndex = messages.length - 1;
  const lastAssistant = lastIndexOfKind(messages, "assistant");
  const footnotes = toolsBeforeAnswers(messages);
  // A call still running has no answer to sit under yet, so it stands on its own line.
  const openTools = messages.filter(
    (message): message is ToolMessage =>
      message.kind === "tool" && message.status === "running" && !isAttached(message, footnotes),
  );
  const canAct = status === "ready";
  // Removing a file mid-turn would fail the tool call, so removal waits until the agent is idle.
  const canDetach = onDetachFile !== undefined && !streaming;
  const waiting = streaming && messages[lastIndex]?.kind !== "assistant" && openTools.length === 0;

  return (
    <div className="xc-wrap" ref={scrollRef} onScroll={onScroll}>
      <div className="xc-col">
        <ThreadHead name={agentName} small />
        <div className="xc-rule" style={{ marginTop: "20px" }} aria-hidden="true" />

        <div className="xc-thread">
          {messages.map((message, index) => {
            if (message.kind === "tool") return null;
            if (message.kind === "attachment") {
              return (
                <div className="attachment-row" key={message.id} role="group" aria-label="Attached files">
                  {attachedFilesOf(message).map((file) => (
                    <div className="attachment-card" key={attachedFileKey(file)} title={file.name}>
                      <span className="attachment-badge" aria-hidden="true">
                        {attachmentBadge(file.name)}
                      </span>
                      <span className="attachment-body">
                        <span className="attachment-name">{file.name}</span>
                        <span className="attachment-meta">{describeAttachment(file)}</span>
                      </span>
                      {canDetach && (
                        <button
                          className="attachment-remove"
                          onClick={() => onDetachFile?.(message.id, attachedFileKey(file))}
                          aria-label={`Remove ${file.name}`}
                          title="Remove this file"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            }
            if (message.kind === "notice") {
              return (
                <div className="notice-marker" key={message.id} role="status">
                  {message.text}
                </div>
              );
            }
            const did = footnotes.get(message.id);
            return (
              <Message
                key={message.id}
                message={message}
                streaming={streaming && index === lastIndex && message.kind === "assistant"}
                onRegenerate={canAct && index === lastAssistant ? onRegenerate : undefined}
                footnote={
                  did === undefined ? undefined : (
                    <>
                      {did.map((tool) => (
                        <ToolFootnote key={tool.id} tool={tool} />
                      ))}
                    </>
                  )
                }
              />
            );
          })}

          {openTools.map((tool) => (
            <div className="xc-turn" key={tool.id}>
              <ToolFootnote tool={tool} />
            </div>
          ))}

          {waiting && (
            <div className="xc-turn">
              <span className="xc-live">
                <span className="xc-pulse" aria-hidden="true" />
                Thinking…
              </span>
            </div>
          )}
        </div>
        <div ref={endRef} />
      </div>
      {!atBottom && (
        <button
          className="scroll-bottom"
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
          aria-label="Scroll to latest"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}

function isAttached(tool: ToolMessage, attached: Map<number, ToolMessage[]>): boolean {
  for (const group of attached.values()) {
    if (group.includes(tool)) return true;
  }
  return false;
}
