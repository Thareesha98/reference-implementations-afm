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
import { ChatPane } from "./ChatPane";
import { initialChatState } from "../../chat-state";
import type { AgentStatus } from "../../chat-state";

type Session = Parameters<typeof ChatPane>[0]["session"];

function chat(status: AgentStatus): string {
  const noop = () => {};
  const session = {
    state: { ...initialChatState, status },
    send: noop,
    stop: noop,
    attachFiles: noop,
    detachFile: noop,
    regenerate: noop,
    editMessage: noop,
    submitPermission: noop,
  } as unknown as Session;
  return renderToStaticMarkup(createElement(ChatPane, { session, serverNameByUrl: new Map(), onReplaceKey: noop, onRetry: noop }));
}

describe("the message box before an agent is ready", () => {
  it("owns the no-agent presentation instead of the disconnected Test prompt", () => {
    const html = chat("no-agent");
    expect(html).toContain("Not started yet");
    expect(html).toContain("Press <strong>Run</strong>");
    expect(html).not.toContain("Not tested yet");
    expect(html).not.toContain("Test this agent");
  });

  it.each([
    ["no-agent", "Press Run to start…"],
    ["connecting", "Loading the agent…"],
    ["not-ready", "The agent didn&#x27;t start…"],
  ] as const)("says what is going on while the agent is %s", (status, placeholder) => {
    const html = chat(status);
    expect(html).toContain(`placeholder="${placeholder}"`);
    expect(html).toContain("disabled");
  });

  it("never falls back to asking for an agent once one exists", () => {
    for (const status of ["connecting", "not-ready", "ready"] as const) {
      expect(chat(status)).not.toContain("Load an agent first");
    }
  });

  it("invites a message once the agent is ready", () => {
    expect(chat("ready")).toContain('placeholder="Message the agent…"');
  });
});
