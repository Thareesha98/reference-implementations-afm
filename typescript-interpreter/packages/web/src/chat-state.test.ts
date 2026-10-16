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
import { chatReducer, initialChatState } from "./chat-state";
import type { ServerMessage } from "./protocol";
import type { ChatState } from "./chat-state";

const loaded = (name: string, mcpServers: string[] = []): ServerMessage => ({
  type: "loaded",
  name,
  mcpServers,
  plan: { runnable: true, issues: [] },
});

describe("chatReducer", () => {
  it("goes connecting -> ready when the agent is loaded, with no check of its own in between", () => {
    let state = chatReducer(initialChatState, { type: "agent-loading", content: "x", keepMessages: false });
    expect(state.status).toBe("connecting");
    expect(state.agentSource).toBe("x");
    state = chatReducer(state, { type: "server", message: loaded("Agent A", ["context7"]) });
    expect(state.status).toBe("ready");
    expect(state.agentName).toBe("Agent A");
    expect(state.mcpServers).toEqual(["context7"]);
  });

  it("learns which tools there are after the agent is ready, without changing its state", () => {
    const tools = [{ name: "search", description: "Search", serverId: "https://docs.example.com/mcp" }];
    let state = chatReducer(initialChatState, { type: "server", message: loaded("Agent A") });
    expect(state.tools).toEqual([]);
    state = chatReducer(state, { type: "server", message: { type: "tools-listed", tools } });
    expect(state.status).toBe("ready");
    expect(state.tools).toEqual(tools);
  });

  it("keeps an agent that is answering answering when the tool list arrives", () => {
    let state = chatReducer(initialChatState, { type: "server", message: loaded("A") });
    state = chatReducer(state, { type: "user-message", text: "hi" });
    state = chatReducer(state, { type: "server", message: { type: "tools-listed", tools: [] } });
    expect(state.status).toBe("streaming");
  });

  it("drops a permission question that is still open when the turn finishes", () => {
    let state = chatReducer(initialChatState, { type: "server", message: loaded("A") });
    state = chatReducer(state, { type: "user-message", text: "hi" });
    state = chatReducer(state, {
      type: "server",
      message: { type: "permission-request", id: "c1", name: "lookup", args: {} },
    });
    state = chatReducer(state, { type: "server", message: { type: "turn-finished", reason: "aborted" } });
    expect(state.pendingPermission).toBeNull();
  });

  it("becomes not-ready with a reason", () => {
    const state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "agent-not-ready", reason: "bad file" },
    });
    expect(state.status).toBe("not-ready");
    expect(state.notReady).toBe("bad file");
  });

  it("keeps messages when editing the agent mid-chat", () => {
    let state = chatReducer(initialChatState, { type: "user-message", text: "hi" });
    state = chatReducer(state, { type: "agent-loading", content: "y", keepMessages: true });
    expect(state.messages).toHaveLength(1);
    expect(state.status).toBe("connecting");
  });

  it("adds the user message and streams deltas into an assistant message", () => {
    let state = chatReducer(initialChatState, { type: "server", message: loaded("A") });
    state = chatReducer(state, { type: "user-message", text: "hi" });
    expect(state.status).toBe("streaming");
    state = chatReducer(state, { type: "server", message: { type: "text-delta", text: "He" } });
    state = chatReducer(state, { type: "server", message: { type: "text-delta", text: "llo" } });
    state = chatReducer(state, { type: "server", message: { type: "turn-finished", reason: "stop" } });
    expect(state.status).toBe("ready");
    expect(state.messages.map((m) => `${m.kind}:${"text" in m ? m.text : ""}`)).toEqual([
      "user:hi",
      "assistant:Hello",
    ]);
  });

  it("rewinds to an earlier message, keeping the files attached after it", () => {
    let state = chatReducer(initialChatState, { type: "user-message", text: "one" });
    state = chatReducer(state, { type: "server", message: { type: "text-delta", text: "answer" } });
    state = chatReducer(state, { type: "user-message", text: "two" });
    state = chatReducer(state, { type: "files-attached", files: [{ name: "a.pdf", path: "a.pdf", chars: 3 }] });
    const second = state.messages.find((message) => message.kind === "user" && message.text === "two");
    state = chatReducer(state, { type: "rewind", id: second?.id ?? -1 });
    expect(state.messages.map((message) => message.kind)).toEqual(["user", "assistant", "attachment"]);
  });

  it("tracks a permission request and clears it on dismiss", () => {
    let state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "permission-request", id: "c1", name: "multiply", args: { a: 2, b: 3 } },
    });
    expect(state.pendingPermission).toEqual({ id: "c1", name: "multiply", args: { a: 2, b: 3 } });
    state = chatReducer(state, { type: "permission-dismissed" });
    expect(state.pendingPermission).toBeNull();
  });

  it("clears a stale permission prompt when the user views a different agent, before it's even loaded", () => {
    let state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "permission-request", id: "c1", name: "multiply", args: {} },
    });
    expect(state.pendingPermission).not.toBeNull();

    state = chatReducer(state, { type: "agent-cleared" });
    expect(state.pendingPermission).toBeNull();
  });

  it("also clears a stale prompt once a different agent actually starts loading", () => {
    let state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "permission-request", id: "c1", name: "multiply", args: {} },
    });
    state = chatReducer(state, { type: "agent-loading", content: "new agent source", keepMessages: false });
    expect(state.pendingPermission).toBeNull();
  });

  it("records an error", () => {
    const state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "error", message: "boom" },
    });
    expect(state.error).toBe("boom");
  });

  it("adds a tool card on call and fills its result (by call id) when it completes", () => {
    let state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "tool-call", id: "c1", name: "multiply", args: { a: 8, b: 17 } },
    });
    const running = state.messages[0];
    expect(running?.kind).toBe("tool");
    expect(running).toMatchObject({ kind: "tool", callId: "c1", name: "multiply", status: "running" });

    state = chatReducer(state, {
      type: "server",
      message: { type: "tool-result", id: "c1", name: "multiply", ok: true, content: "136" },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ kind: "tool", status: "ok", result: "136" });
  });

  it("marks a failed tool result", () => {
    let state = chatReducer(initialChatState, {
      type: "server",
      message: { type: "tool-call", id: "c1", name: "boom", args: {} },
    });
    state = chatReducer(state, {
      type: "server",
      message: { type: "tool-result", id: "c1", name: "boom", ok: false, content: "nope" },
    });
    expect(state.messages[0]).toMatchObject({ kind: "tool", status: "failed", result: "nope" });
  });

  it("starts a new assistant message for text that follows a tool card", () => {
    let state = chatReducer(initialChatState, { type: "server", message: loaded("A") });
    state = chatReducer(state, { type: "user-message", text: "q" });
    state = chatReducer(state, { type: "server", message: { type: "tool-call", id: "c1", name: "t", args: {} } });
    state = chatReducer(state, { type: "server", message: { type: "text-delta", text: "answer" } });
    expect(state.messages.map((m) => m.kind)).toEqual(["user", "tool", "assistant"]);
  });

  it("adds a local attachment marker, not tied to any ServerMessage", () => {
    const files = [
      { name: "report.pdf", chars: 4000, pages: 3 },
      { name: "notes.md", chars: 120 },
    ];
    const state = chatReducer(initialChatState, { type: "files-attached", files });
    expect(state.messages).toEqual([{ kind: "attachment", id: 1, files }]);
  });

  it("interleaves an attachment marker with real chat turns in order", () => {
    let state = chatReducer(initialChatState, { type: "server", message: loaded("A") });
    state = chatReducer(state, { type: "user-message", text: "hi" });
    state = chatReducer(state, { type: "files-attached", files: [{ name: "report.pdf" }] });
    state = chatReducer(state, { type: "user-message", text: "summarize it" });
    expect(state.messages.map((m) => m.kind)).toEqual(["user", "attachment", "user"]);
  });

  it("removes a single attached file and leaves the rest of the row alone", () => {
    let state = chatReducer(initialChatState, {
      type: "files-attached",
      files: [
        { name: "a.pdf", path: "a.pdf", pages: 2 },
        { name: "b.md", path: "b.md", chars: 10 },
      ],
    });
    state = chatReducer(state, { type: "file-detached", id: 1, key: "a.pdf" });
    expect(state.messages).toEqual([{ kind: "attachment", id: 1, files: [{ name: "b.md", path: "b.md", chars: 10 }] }]);
  });

  it("drops the attachment row once its last file is removed", () => {
    let state = chatReducer(initialChatState, { type: "user-message", text: "hi" });
    state = chatReducer(state, { type: "files-attached", files: [{ name: "a.pdf", path: "a.pdf" }] });
    state = chatReducer(state, { type: "file-detached", id: 2, key: "a.pdf" });
    expect(state.messages.map((m) => m.kind)).toEqual(["user"]);
  });

  it("removes a file from a conversation saved with the old name-only shape", () => {
    const legacy = { kind: "attachment", id: 1, names: ["report.pdf", "notes.md"] };
    const state = chatReducer(
      { ...initialChatState, messages: [legacy] as never, nextId: 2 },
      { type: "file-detached", id: 1, key: "report.pdf" },
    );
    expect(state.messages).toEqual([{ kind: "attachment", id: 1, files: [{ name: "notes.md" }] }]);
  });

  it("leaves other attachment rows untouched when one file is removed", () => {
    let state = chatReducer(initialChatState, { type: "files-attached", files: [{ name: "a.pdf", path: "a.pdf" }] });
    state = chatReducer(state, { type: "files-attached", files: [{ name: "a.pdf", path: "docs/a.pdf" }] });
    state = chatReducer(state, { type: "file-detached", id: 1, key: "a.pdf" });
    expect(state.messages).toEqual([{ kind: "attachment", id: 2, files: [{ name: "a.pdf", path: "docs/a.pdf" }] }]);
  });

  it("keeps message ids unique (stable React keys)", () => {
    let state = chatReducer(initialChatState, { type: "user-message", text: "a" });
    state = chatReducer(state, { type: "server", message: { type: "text-delta", text: "x" } });
    state = chatReducer(state, { type: "server", message: { type: "turn-finished", reason: "stop" } });
    state = chatReducer(state, { type: "user-message", text: "b" });
    const ids = state.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("load steps", () => {
  const step = (key: string, label: string, state: "active" | "done" | "failed", note?: string) =>
    ({ type: "load-step", key, label, state, note }) as const;

  it("appends each new stage in the order it was reported", () => {
    let s = chatReducer(initialChatState, { type: "server", message: step("file", "Reading", "active") });
    s = chatReducer(s, { type: "server", message: step("model", "Connecting", "active") });
    expect(s.loadSteps.map((x) => x.key)).toEqual(["file", "model"]);
  });

  it("settles a stage in place rather than adding a second entry", () => {
    let s = chatReducer(initialChatState, { type: "server", message: step("file", "Reading", "active") });
    s = chatReducer(s, { type: "server", message: step("model", "Connecting", "active") });
    s = chatReducer(s, { type: "server", message: step("file", "Reading", "done") });
    expect(s.loadSteps.map((x) => x.key)).toEqual(["file", "model"]);
    expect(s.loadSteps[0]?.state).toBe("done");
  });

  it("keeps the failure reason on the stage that failed", () => {
    let s = chatReducer(initialChatState, { type: "server", message: step("mcp:gitlab", "Connecting to gitlab", "active") });
    s = chatReducer(s, { type: "server", message: step("mcp:gitlab", "Connecting to gitlab", "failed", "401") });
    expect(s.loadSteps[0]).toMatchObject({ state: "failed", note: "401" });
  });

  it("clears the previous run's stages when a new load starts", () => {
    let s = chatReducer(initialChatState, { type: "server", message: step("file", "Reading", "done") });
    s = chatReducer(s, { type: "agent-loading", content: "x", keepMessages: false });
    expect(s.loadSteps).toEqual([]);
  });

  it("keeps the stages after a failure so the user can see how far it got", () => {
    let s = chatReducer(initialChatState, { type: "server", message: step("file", "Reading", "done") });
    s = chatReducer(s, { type: "server", message: { type: "agent-not-ready", reason: "boom" } });
    expect(s.status).toBe("not-ready");
    expect(s.loadSteps).toHaveLength(1);
  });
});

describe("how a turn ended", () => {
  const finish = (reason: "stop" | "max-iterations" | "budget" | "aborted") =>
    ({ type: "server", message: { type: "turn-finished", reason } }) as const;

  const notices = (state: { messages: { kind: string }[] }) =>
    state.messages.filter((m) => m.kind === "notice");

  it("says nothing extra when the agent simply finished", () => {
    const s = chatReducer(initialChatState, finish("stop"));
    expect(s.status).toBe("ready");
    expect(notices(s)).toHaveLength(0);
  });

  it("warns that the answer may be unfinished when the iteration limit was hit", () => {
    const s = chatReducer(initialChatState, finish("max-iterations"));
    expect(s.status).toBe("ready");
    expect(notices(s)).toHaveLength(1);
    expect(notices(s)[0]).toMatchObject({ text: expect.stringContaining("max_iterations") });
  });

  it("names the limit it hit once the budget is known", () => {
    let s = chatReducer(initialChatState, {
      type: "server",
      message: {
        type: "budget-update",
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        iteration: 10,
        maxIterations: 10,
        elapsedMs: 5,
      },
    });
    s = chatReducer(s, finish("max-iterations"));
    expect(notices(s)[0]).toMatchObject({ text: expect.stringContaining("10 steps") });
  });

  it("confirms a Stop, and flags a budget cut-off", () => {
    expect(notices(chatReducer(initialChatState, finish("aborted")))[0]).toMatchObject({
      text: expect.stringContaining("Stopped"),
    });
    expect(notices(chatReducer(initialChatState, finish("budget")))[0]).toMatchObject({
      text: expect.stringContaining("budget"),
    });
  });
});

describe("a start that fails", () => {
  it("keeps the steps that passed and marks the one that broke", () => {
    let s = chatReducer(initialChatState, { type: "agent-loading", content: "x", keepMessages: false });
    s = chatReducer(s, { type: "server", message: { type: "load-step", key: "file", label: "Reading the agent file", state: "done" } });
    s = chatReducer(s, { type: "server", message: { type: "load-step", key: "model", label: "Connecting to anthropic", state: "failed", note: "401 Unauthorized" } });
    s = chatReducer(s, { type: "server", message: { type: "agent-not-ready", reason: "401 Unauthorized" } });

    expect(s.status).toBe("not-ready");
    expect(s.notReady).toBe("401 Unauthorized");
    expect(s.loadSteps.map((x) => `${x.key}:${x.state}`)).toEqual(["file:done", "model:failed"]);
    expect(s.loadSteps[1]?.note).toBe("401 Unauthorized");
  });

  it("clears the previous failure when the agent is started again", () => {
    let s = chatReducer(initialChatState, { type: "server", message: { type: "agent-not-ready", reason: "boom" } });
    s = chatReducer(s, { type: "agent-loading", content: "x", keepMessages: false });
    expect(s.notReady).toBeNull();
    expect(s.loadSteps).toEqual([]);
    expect(s.status).toBe("connecting");
  });
});

function withSecrets(names: string[]): ChatState {
  return chatReducer(initialChatState, { type: "server", message: { type: "secrets-list", names } });
}

describe("savedSecrets", () => {
  it("are the names the worker last listed", () => {
    expect(withSecrets(["OPENAI_API_KEY", "HF_TOKEN"]).savedSecrets).toEqual(["OPENAI_API_KEY", "HF_TOKEN"]);
  });

  it("are empty before the worker has said anything", () => {
    expect(initialChatState.savedSecrets).toEqual([]);
  });

  it("stay across an agent switch, so switching files does not lose a key", () => {
    const state = chatReducer(withSecrets(["OPENAI_API_KEY"]), { type: "agent-cleared" });
    expect(state.savedSecrets).toEqual(["OPENAI_API_KEY"]);
  });
});
