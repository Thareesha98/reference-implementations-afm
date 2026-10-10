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
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "./MessageList";
import type { AgentStatus, UiMessage } from "../chat-state";

const THREAD: UiMessage[] = [
  { kind: "user", id: 1, text: "hello" },
  { kind: "assistant", id: 2, text: "Hi there" },
];

function list(status: AgentStatus, messages: UiMessage[], notReady: string | null = null): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      streaming: false,
      status,
      agentName: "Demo",
      loadSteps: [],
      notReady,
      onRetry: () => {},
      onRegenerate: () => {},
      onEdit: () => {},
      onDetachFile: () => {},
    }),
  );
}

describe("a thread whose agent did not start", () => {
  it("keeps the conversation and says why, with a way to try again", () => {
    const out = list("not-ready", THREAD, "'OPENAI_API_KEY' is not in the host config");
    expect(out).toContain("Hi there");
    expect(out).toContain("xc-notready");
    expect(out).toContain("OPENAI_API_KEY");
    expect(out).toContain("Try again");
  });

  it("shows nothing about a failure while the agent is fine", () => {
    expect(list("ready", THREAD)).not.toContain("xc-notready");
  });

  it("shows nothing about a failure while the agent is still starting", () => {
    expect(list("connecting", THREAD)).not.toContain("xc-notready");
  });

  it("gives an empty thread the full-size explanation instead of the in-thread one", () => {
    const out = list("not-ready", [], "Unsupported model provider");
    expect(out).toContain("Agent isn&#x27;t ready");
    expect(out).not.toContain("xc-notready");
  });
});
