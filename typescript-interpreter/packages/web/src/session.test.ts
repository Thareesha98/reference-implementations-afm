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

import { describe, it, expect, vi } from "vitest";
import { AgentSession } from "./session";
import { compositeToolPort, inPageToolPort, namespacedToolPort } from "@afm/adapter-tool";
import { configSecretPort } from "@afm/adapter-secret";
import { allowAllPermissions } from "@afm/engine";
import type { ChatMessage, ModelPort } from "@afm/engine";
import type { ServerMessage, LoadStep } from "./protocol";

function replyingModel(): ModelPort {
  return {
    async *stream() {
      yield { type: "text-delta", text: "Hello " };
      yield { type: "text-delta", text: "there." };
      yield { type: "finish", reason: "stop" };
    },
  };
}

function makeSession(createModel = async () => replyingModel()) {
  const emitted: ServerMessage[] = [];
  const steps: LoadStep[] = [];
  const session = new AgentSession({
    createModel,
    createTools: () => inPageToolPort([]),
    filesTools: inPageToolPort([]),
    describeAttachedFiles: () => "no files attached",
    secrets: configSecretPort({}),
    permission: allowAllPermissions,
    emit: (message) => {
      if (message.type === "load-step") steps.push(message);
      else emitted.push(message);
    },
  });
  return { session, emitted, steps };
}

const VALID = `---
name: Tester
interfaces:
  - type: webchat
---

# Role
r

# Instructions
i
`;

const WITH_SKILLS = `---
name: Tester
interfaces:
  - type: webchat
skills:
  - type: local
    path: ./skills/demo/SKILL.md
---

# Role
r

# Instructions
i
`;

describe("AgentSession", () => {
  it("emits 'loaded' and then the tools it found, for a valid file", async () => {
    const { session, emitted } = makeSession();
    await session.load(VALID);
    expect(emitted).toEqual([
      {
        type: "loaded",
        name: "Tester",
        mcpServers: [],
        plan: { runnable: true, issues: [] },
      },
      { type: "tools-listed", tools: [] },
    ]);
  });

  it("is usable as soon as it is loaded, without waiting for its tools to be listed", async () => {
    let release: () => void = () => {};
    const slowTools = {
      async list() {
        await new Promise<void>((resolve) => (release = resolve));
        return [];
      },
      async execute() {
        return { ok: true, content: "" };
      },
    };
    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: async () => replyingModel(),
      createTools: () => slowTools,
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });

    const loading = session.load(VALID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitted.map((m) => m.type)).toEqual(["loaded"]);

    release();
    await loading;
    expect(emitted.map((m) => m.type)).toEqual(["loaded", "tools-listed"]);
  });

  it("does not take a loaded agent back when a server never answers while its tools are listed", async () => {
    const silentTools = {
      async list(): Promise<never> {
        throw new Error("connect ECONNREFUSED");
      },
      async execute() {
        return { ok: false, content: "" };
      },
    };
    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: async () => replyingModel(),
      createTools: () => silentTools,
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });

    await session.load(VALID);
    expect(emitted.map((m) => m.type)).toEqual(["loaded"]);
  });

  it("streams a reply and finishes when a message is sent", async () => {
    const { session, emitted } = makeSession();
    await session.load(VALID);
    emitted.length = 0;
    await session.send("hello");
    const deltas = emitted.filter((m) => m.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((m) => (m.type === "text-delta" ? m.text : "")).join("").trim()).not.toBe("");
    expect(emitted.at(-1)).toEqual({ type: "turn-finished", reason: "stop" });
  });

  it("remembers what a tool said, so a follow-up does not ask for it again", async () => {
    const seen: ChatMessage[][] = [];
    let turn = 0;
    const model = async () => ({
      async *stream(request: { messages: ChatMessage[] }) {
        seen.push(request.messages);
        turn += 1;
        if (turn === 1) {
          yield { type: "tool-call" as const, id: "c1", name: "weather", args: {} };
          return;
        }
        yield { type: "text-delta" as const, text: "28C." };
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });

    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: model,
      createTools: () =>
        inPageToolPort([{ name: "weather", inputSchema: { type: "object" }, run: () => "28C and humid" }]),
        filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });

    await session.load(VALID);
    await session.send("weather?");
    await session.send("and tomorrow?");

    const followUp = seen.at(-1) ?? [];
    expect(followUp.some((m) => m.role === "tool" && m.content === "28C and humid")).toBe(true);
    expect(followUp.some((m) => m.role === "assistant" && m.content === "28C.")).toBe(true);
    expect(followUp.at(-1)).toEqual({ role: "user", content: "and tomorrow?" });
  });

  it("starts again from an earlier message when told how many turns to keep", async () => {
    const seen: ChatMessage[][] = [];
    const model = async () => ({
      async *stream(request: { messages: ChatMessage[] }) {
        seen.push(request.messages);
        yield { type: "text-delta" as const, text: "ok" };
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });
    const { session } = makeSession(model);
    await session.load(VALID);
    await session.send("one");
    await session.send("two");
    await session.send("two, again", undefined, 1);
    const last = seen.at(-1) ?? [];
    expect(last.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(last[0]?.content).toBe("one");
    expect(last.at(-1)?.content).toBe("two, again");
  });

  it("errors when sending before loading", async () => {
    const { session, emitted } = makeSession();
    await session.send("hi");
    expect(emitted[0]?.type).toBe("error");
  });

  it("is not ready on a malformed file", async () => {
    const { session, emitted } = makeSession();
    await session.load("---\nname: x\n\n# Role\nr\n");
    expect(emitted[0]?.type).toBe("agent-not-ready");
  });

  it("is not ready (does not load) if the model cannot be built", async () => {
    const { session, emitted } = makeSession(async () => {
      throw new Error("No API key was provided for the model.");
    });
    await session.load(VALID);
    expect(emitted[0]?.type).toBe("agent-not-ready");
    emitted.length = 0;
    await session.send("hi");
    expect(emitted[0]?.type).toBe("error");
  });

  it("runs an agent that declares skills, without loading them", async () => {
    const seenSystemPrompts: string[] = [];
    const capturingModel = async () => ({
      async *stream(request: { system: string }) {
        seenSystemPrompts.push(request.system);
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });

    const mcpPort = inPageToolPort([
      { name: "mcp-tool", inputSchema: { type: "object" }, run: () => "mcp result" },
    ]);

    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: capturingModel,
      createTools: () => mcpPort,
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });

    await session.load(WITH_SKILLS);
    expect(emitted[0]).toMatchObject({ type: "loaded", name: "Tester" });
    expect(emitted[1]).toMatchObject({ type: "tools-listed" });

    await session.send("hi");
    expect(seenSystemPrompts[0]).not.toContain("available_skills");
    expect(seenSystemPrompts[0]).not.toContain("activate_skill");
  });

  it("always includes the files system note, and merges the (always-present) files tool port", async () => {
    const seenSystemPrompts: string[] = [];
    const capturingModel = async () => ({
      async *stream(request: { system: string }) {
        seenSystemPrompts.push(request.system);
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });

    const attached = new Map<string, { name: string; path: string; text: string }>([
      ["report.pdf", { name: "report.pdf", path: "report.pdf", text: "quarterly numbers" }],
    ]);
    const filesPort = inPageToolPort([
      { name: "list_files", inputSchema: { type: "object" }, run: () => `${attached.size} file(s) attached` },
    ]);

    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: capturingModel,
      createTools: () => inPageToolPort([]),
        filesTools: filesPort,
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });

    await session.load(VALID);
    expect(emitted[1]).toMatchObject({ type: "tools-listed", tools: [{ name: "list_files" }] });

    await session.send("hi");
    expect(seenSystemPrompts[0]).toContain("## Attached Files");
    expect(seenSystemPrompts[0]).toContain("list_files");
  });

  it("tells the model what is attached right now, re-read on every turn", async () => {
    const seenSystemPrompts: string[] = [];
    const capturingModel = async () => ({
      async *stream(request: { system: string }) {
        seenSystemPrompts.push(request.system);
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });

    let attached = "No files are currently attached.";
    const session = new AgentSession({
      createModel: capturingModel,
      createTools: () => inPageToolPort([]),
        filesTools: inPageToolPort([]),
      describeAttachedFiles: () => attached,
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: () => {},
    });

    await session.load(VALID);
    await session.send("anything attached?");
    expect(seenSystemPrompts[0]).toContain("No files are currently attached.");

    attached = "1 file(s) attached:\n- paper.pdf (48,120 characters, 11 pages)";
    await session.send("now?");
    expect(seenSystemPrompts[1]).toContain("paper.pdf (48,120 characters, 11 pages)");
  });

  it("disposes the previous tools when a new agent is loaded (no leaked MCP connections)", async () => {
    const disposed: number[] = [];
    let built = 0;
    const session = new AgentSession({
      createModel: async () => replyingModel(),
      createTools: () => {
        const id = built++;
        return {
          list: () => Promise.resolve([]),
          execute: () => Promise.resolve({ ok: true, content: "" }),
          dispose: () => Promise.resolve(void disposed.push(id)),
        };
      },
        filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: () => {},
    });
    await session.load(VALID);
    await session.load(VALID);
    expect(disposed).toEqual([0]);
  });
});

describe("AgentSession when two loads overlap", () => {
  const withRole = (role: string) => VALID.replace("# Role\nr", `# Role\n${role}`);

  function overlapping() {
    const systems: string[] = [];
    const emitted: ServerMessage[] = [];
    const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
    const model: ModelPort = {
      async *stream(request) {
        systems.push(request.system);
        yield { type: "text-delta", text: "ok" };
      },
    };
    const session = new AgentSession({
      createModel: () =>
        new Promise<ModelPort>((resolve, reject) => {
          pending.push({ resolve: () => resolve(model), reject });
        }),
      createTools: () => inPageToolPort([]),
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });
    async function untilStarted(count: number): Promise<void> {
      for (let i = 0; i < 50 && pending.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { session, systems, emitted, pending, untilStarted };
  }

  it("keeps the newest agent when an older load finishes after it", async () => {
    const { session, systems, emitted, pending, untilStarted } = overlapping();
    const first = session.load(withRole("first role"));
    await untilStarted(1);
    const second = session.load(withRole("second role"));
    await untilStarted(2);

    pending[1]!.resolve();
    await second;
    pending[0]!.resolve();
    await first;

    expect(emitted.filter((m) => m.type === "loaded")).toHaveLength(1);
    expect(emitted.filter((m) => m.type === "tools-listed")).toHaveLength(1);
    await session.send("hello");
    expect(systems[0]).toContain("second role");
  });

  it("does not let an older load that fails late take the newest agent away", async () => {
    const { session, systems, emitted, pending, untilStarted } = overlapping();
    const first = session.load(withRole("first role"));
    await untilStarted(1);
    const second = session.load(withRole("second role"));
    await untilStarted(2);

    pending[1]!.resolve();
    await second;
    pending[0]!.reject(new Error("the old model is gone"));
    await first;

    expect(emitted.some((m) => m.type === "agent-not-ready")).toBe(false);
    await session.send("hello");
    expect(systems[0]).toContain("second role");
  });
});

describe("AgentSession - an agent the browser cannot run", () => {
  const SIGNS_ITS_OWN_TOKEN = `---
name: Signer
tools:
  mcp:
    - name: internal
      transport:
        type: http
        url: https://internal.example.com/mcp
        authentication:
          type: jwt
          issuer: afm
          signing_key: not-a-real-key
---

# Role
Signer.

# Instructions
Call the tools.
`;

  it("refuses at the file stage with the plan's own message, before connecting to anything", async () => {
    let modelsCreated = 0;
    const { session, emitted, steps } = makeSession(async () => {
      modelsCreated += 1;
      return replyingModel();
    });
    await session.load(SIGNS_ITS_OWN_TOKEN);

    expect(modelsCreated).toBe(0);
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual(["file:active", "file:failed"]);
    const notReady = emitted.find((m) => m.type === "agent-not-ready");
    expect(notReady).toMatchObject({ type: "agent-not-ready" });
    expect(notReady && "reason" in notReady ? notReady.reason : "").toMatch(/'internal'.*jwt.*oauth2.*bearer/);
  });
});

describe("AgentSession load steps", () => {
  it("reports each stage active then done, in order, for a good load", async () => {
    const { session, steps } = makeSession();
    await session.load(VALID);
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "file:active",
      "file:done",
      "model:active",
      "model:done",
    ]);
  });

  it("announces no skills stage, even for an agent that declares skills", async () => {
    const { session, steps } = makeSession();
    await session.load(WITH_SKILLS);
    expect(steps.some((s) => s.key === "skills")).toBe(false);
  });

  it("marks the stage that actually failed, and does not mark later ones", async () => {
    const { session, steps } = makeSession(async () => {
      throw new Error("no key");
    });
    await session.load(VALID);
    expect(steps.filter((s) => s.key === "file").at(-1)?.state).toBe("done");
    const model = steps.filter((s) => s.key === "model").at(-1);
    expect(model?.state).toBe("failed");
    expect(model?.note).toContain("no key");
  });
});

describe("AgentSession regenerate", () => {
  const TOOL_AGENT = VALID;

  function sessionWithToolModel() {
    const seen: ChatMessage[][] = [];
    let call = 0;
    const createModel = async () => ({
      async *stream(request: { messages: ChatMessage[] }) {
        seen.push(request.messages);
        call += 1;
        if (call === 1) {
          yield { type: "tool-call" as const, id: "c1", name: "echo", args: {} };
        } else {
          yield { type: "text-delta" as const, text: "second answer" };
        }
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });
    const session = new AgentSession({
      createModel,
      createTools: () =>
        inPageToolPort([{ name: "echo", inputSchema: { type: "object" }, run: () => "echoed" }]),
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: () => {},
    });
    return { session, seen };
  }

  it("re-asks the same question and leaves no tool call without its result", async () => {
    const { session, seen } = sessionWithToolModel();
    await session.load(TOOL_AGENT);
    await session.send("what is it?");

    await session.regenerate();

    const retry = seen[seen.length - 1] ?? [];
    expect(retry).toEqual([{ role: "user", content: "what is it?" }]);

    const orphaned = retry.filter(
      (message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0,
    );
    expect(orphaned).toEqual([]);
  });

  it("keeps earlier turns and only replaces the newest one", async () => {
    const { session, seen } = sessionWithToolModel();
    await session.load(TOOL_AGENT);
    await session.send("first");
    await session.send("second");

    await session.regenerate();

    const retry = seen[seen.length - 1] ?? [];
    expect(retry[0]).toEqual({ role: "user", content: "first" });
    expect(retry[retry.length - 1]).toEqual({ role: "user", content: "second" });
  });

  it("does nothing when the user has not asked anything yet", async () => {
    const { session, seen } = sessionWithToolModel();
    await session.load(TOOL_AGENT);
    const before = seen.length;
    await session.regenerate();
    expect(seen.length).toBe(before);
  });
});

describe("AgentSession load failure", () => {
  const BROKEN = "no frontmatter, no role, no instructions";

  it("stops the previous agent from answering when a later load fails", async () => {
    const { session, emitted } = makeSession();
    await session.load(VALID);
    emitted.length = 0;

    await session.load(BROKEN);
    expect(emitted.some((m) => m.type === "agent-not-ready")).toBe(true);

    emitted.length = 0;
    await session.send("still there?");
    expect(emitted).toEqual([{ type: "error", message: "No agent loaded yet." }]);
  });
});

describe("AgentSession concurrent sends", () => {
  it("refuses a second send while one is still running, and frees up afterwards", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowModel = async () => ({
      async *stream() {
        await gate;
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });

    const { session, emitted } = makeSession(slowModel);
    await session.load(VALID);
    emitted.length = 0;

    const first = session.send("one");
    await session.send("two");
    expect(emitted.some((m) => m.type === "error" && m.message.includes("still answering"))).toBe(true);

    release();
    await first;

    emitted.length = 0;
    await session.send("three");
    expect(emitted.some((m) => m.type === "error")).toBe(false);
  });
});

describe("AgentSession when the conversation is replaced mid-answer", () => {
  function heldReply() {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let begin = () => {};
    const begun = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const seen: ChatMessage[][] = [];
    const model = async () => ({
      async *stream(request: { messages: ChatMessage[] }) {
        seen.push(request.messages);
        if (seen.length === 1) {
          yield { type: "text-delta" as const, text: "unfinished " };
          begin();
          await held;
          yield { type: "text-delta" as const, text: "and then some" };
        } else {
          yield { type: "text-delta" as const, text: "fresh" };
        }
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });
    return { model, seen, release, begun };
  }

  const NEXT_ANSWER = [
    { type: "text-delta", text: "fresh" },
    { type: "turn-finished", reason: "stop" },
  ];

  it("does not let the earlier answer reach the agent that replaced it", async () => {
    const { model, seen, release, begun } = heldReply();
    const { session, emitted } = makeSession(model);
    await session.load(VALID);
    const answering = session.send("before");
    await begun;

    await session.load(VALID);
    emitted.length = 0;
    release();
    await answering;
    await session.send("after");

    expect(emitted).toEqual(NEXT_ANSWER);
    expect(seen[1]).toEqual([{ role: "user", content: "after" }]);
  });

  it("starts the next answer from an empty conversation after the chat is reset", async () => {
    const { model, seen, release, begun } = heldReply();
    const { session, emitted } = makeSession(model);
    await session.load(VALID);
    const answering = session.send("before");
    await begun;

    session.resetChat();
    emitted.length = 0;
    release();
    await answering;
    await session.send("after");

    expect(emitted).toEqual(NEXT_ANSWER);
    expect(seen[1]).toEqual([{ role: "user", content: "after" }]);
  });
});

describe("AgentSession permissions", () => {
  const DOCS = "https://docs.example.com/mcp";
  const OTHER = "https://other.example.com/mcp";

  const agentWith = (tools: string) => `---
name: Tester
interfaces:
  - type: webchat
${tools}---

# Role
r

# Instructions
i
`;

  const listing = (url: string, allow?: string[]) =>
    agentWith(
      [
        "tools:",
        "  mcp:",
        "    - name: docs",
        "      transport:",
        "        type: http",
        `        url: ${url}`,
        ...(allow === undefined ? [] : ["      tool_filter:", "        allow:", ...allow.map((name) => `          - ${name}`)]),
      ].join("\n") + "\n",
    );

  function serverTools(url: string) {
    return namespacedToolPort(
      {
        async list() {
          return [{ name: "echo", inputSchema: { type: "object" as const }, serverId: url }];
        },
        async execute() {
          return { ok: true, content: "echoed" };
        },
      },
      "docs",
    );
  }

  function callingEcho() {
    let turn = 0;
    return async () => ({
      async *stream() {
        turn += 1;
        if (turn % 2 === 1) yield { type: "tool-call" as const, id: `c${turn}`, name: "docs__echo", args: {} };
        else yield { type: "text-delta" as const, text: "done" };
        yield { type: "finish" as const, reason: "stop" as const };
      },
    });
  }

  function sessionOn(serverUrl: string) {
    const asked: string[] = [];
    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: callingEcho(),
      createTools: () => serverTools(serverUrl),
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: {
        request: vi.fn(async (call: { serverId?: string; name: string }) => {
          asked.push(`${call.serverId}::${call.name}`);
          return "deny" as const;
        }),
      },
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });
    return { session, asked, emitted };
  }

  const toolResult = (emitted: ServerMessage[]) => emitted.find((m) => m.type === "tool-result");

  it("runs a tool the file lists as allowed without asking anyone", async () => {
    const { session, asked, emitted } = sessionOn(DOCS);
    await session.load(listing(DOCS, ["echo"]));
    await session.send("go");
    expect(asked).toEqual([]);
    expect(toolResult(emitted)).toMatchObject({ ok: true, content: "echoed" });
  });

  it("asks about a tool the file does not list", async () => {
    const { session, asked } = sessionOn(DOCS);
    await session.load(listing(DOCS, ["something_else"]));
    await session.send("go");
    expect(asked).toEqual([`${DOCS}::docs__echo`]);
  });

  it("asks about every tool on a server whose tools the file does not list", async () => {
    const { session, asked } = sessionOn(DOCS);
    await session.load(listing(DOCS));
    await session.send("go");
    expect(asked).toEqual([`${DOCS}::docs__echo`]);
  });

  it("does not let a tool allowed on one server be run on another without asking", async () => {
    const { session, asked } = sessionOn(OTHER);
    await session.load(listing(DOCS, ["echo"]));
    await session.send("go");
    expect(asked).toEqual([`${OTHER}::docs__echo`]);
  });

  it("stops allowing what an earlier file listed once another agent is loaded", async () => {
    const { session, asked } = sessionOn(DOCS);
    await session.load(listing(DOCS, ["echo"]));
    await session.load(listing(DOCS, ["something_else"]));
    await session.send("go");
    expect(asked).toEqual([`${DOCS}::docs__echo`]);
  });

  it("denies a tool the person denied, and tells the model so", async () => {
    const { session, emitted } = sessionOn(DOCS);
    await session.load(listing(DOCS, ["something_else"]));
    await session.send("go");
    expect(toolResult(emitted)).toMatchObject({ ok: false, content: "Tool call was denied by the user." });
  });
});

describe("AgentSession tool names", () => {
  const agentWithServers = (names: string[]) => `---
name: Tester
interfaces:
  - type: webchat
tools:
  mcp:
${names.map((name, index) => `    - name: ${name}\n      transport:\n        type: http\n        url: https://s${index}.example.com/mcp`).join("\n")}
---

# Role
r

# Instructions
i
`;

  const offering = (url: string, tools: string[]) => ({
    async list() {
      return tools.map((name) => ({ name, inputSchema: { type: "object" as const }, serverId: url }));
    },
    async execute() {
      return { ok: true, content: "" };
    },
  });

  function sessionWith(createTools: () => ReturnType<typeof compositeToolPort>) {
    const emitted: ServerMessage[] = [];
    const session = new AgentSession({
      createModel: async () => replyingModel(),
      createTools,
      filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: (message) => {
        if (message.type !== "load-step") emitted.push(message);
      },
    });
    return { session, emitted };
  }

  it("lists each server's tools under their prefixed names", async () => {
    const { session, emitted } = sessionWith(() =>
      compositeToolPort([
        namespacedToolPort(offering("https://s0.example.com/mcp", ["search"]), "first"),
        namespacedToolPort(offering("https://s1.example.com/mcp", ["search"]), "second"),
      ]),
    );
    await session.load(agentWithServers(["first", "second"]));
    expect(emitted.find((message) => message.type === "tools-listed")).toMatchObject({
      tools: [{ name: "first__search" }, { name: "second__search" }],
    });
    expect(emitted.some((message) => message.type === "agent-not-ready")).toBe(false);
  });

  it("is not ready when two servers would offer the same tool under the same name, and says which servers and tool", async () => {
    const { session, emitted } = sessionWith(() =>
      compositeToolPort([
        namespacedToolPort(offering("https://s0.example.com/mcp", ["search"]), "a_b"),
        namespacedToolPort(offering("https://s1.example.com/mcp", ["search"]), "a-b"),
      ]),
    );
    await session.load(agentWithServers(["a_b", "a-b"]));
    const notReady = emitted.find((message) => message.type === "agent-not-ready");
    expect(notReady).toMatchObject({ reason: expect.stringMatching(/'a_b' and 'a-b'.*'search'/) });
    expect(emitted.some((message) => message.type === "tools-listed")).toBe(false);
    await session.send("hello");
    expect(emitted.at(-1)).toMatchObject({ type: "error" });
  });

  it("is not ready when a prefixed name is longer than the providers allow", async () => {
    const long = "t".repeat(60);
    const { session, emitted } = sessionWith(() => compositeToolPort([namespacedToolPort(offering("https://s0.example.com/mcp", [long]), "docs")]));
    await session.load(agentWithServers(["docs"]));
    expect(emitted.find((message) => message.type === "agent-not-ready")).toMatchObject({
      reason: expect.stringContaining("longer than the 64 characters"),
    });
  });

  it("stays ready when a server cannot be reached, because that is not a naming problem", async () => {
    const unreachable = { async list(): Promise<never> { throw new Error("unreachable"); }, async execute() { return { ok: false, content: "" }; } };
    const { session, emitted } = sessionWith(() => compositeToolPort([namespacedToolPort(unreachable, "docs")]));
    await session.load(agentWithServers(["docs"]));
    expect(emitted.some((message) => message.type === "agent-not-ready")).toBe(false);
  });
});
