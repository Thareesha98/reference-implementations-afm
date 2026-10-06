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
import { AgentSession } from "./session";
import { inPageToolPort } from "@afm/adapter-tool";
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

// Progress stages are collected separately: they are a running commentary, and mixing them
// into `emitted` would make every assertion about the load contract depend on their wording.
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
  it("emits 'loaded' then 'agent-ready' after the self-test for a valid file", async () => {
    const { session, emitted } = makeSession();
    await session.load(VALID);
    expect(emitted).toEqual([
      {
        type: "loaded",
        name: "Tester",
        mcpServers: [],
        plan: { runnable: true, issues: [] },
      },
      { type: "agent-ready", toolCount: 0, tools: [] },
    ]);
  });

  it("streams a reply and finishes when a message is sent", async () => {
    const { session, emitted } = makeSession();
    await session.load(VALID);
    emitted.length = 0;
    await session.send("hello");
    const deltas = emitted.filter((m) => m.type === "text-delta");
    // What matters here is that a reply streamed in pieces and the turn closed - not what the
    // stand-in model happens to say.
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((m) => (m.type === "text-delta" ? m.text : "")).join("").trim()).not.toBe("");
    expect(emitted.at(-1)).toEqual({ type: "turn-finished", reason: "stop" });
  });

  it("remembers what a tool said, so a follow-up does not ask for it again", async () => {
    // Keeping only the user text and the final answer would drop the tool exchange, leaving
    // the next question to a model that never saw the result.
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

  // `skills:` is still valid in an agent file - the editor accepts it and the agent runs - but
  // this runtime does not load skills, so nothing is fetched, no catalog reaches the model, and
  // no activate_skill tool is offered.
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
    // The agent is ready and its own tools work; only the skill tools are absent.
    expect(emitted[1]).toMatchObject({ toolCount: 1 });

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
    expect(emitted[1]).toMatchObject({ toolCount: 1, tools: [{ name: "list_files" }] });

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

    // Files are attached after the agent has loaded, so the tool list has to be rebuilt or the
    // next message is answered with "nothing is attached".
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

  it("passes each load's own loadId to createTools, unaffected by a later, overlapping load", async () => {
    const toolsLoadIds: string[] = [];
    const gates = new Map<string, () => void>();
    function gatedList(loadId: string): Promise<[]> {
      return new Promise((resolve) => {
        gates.set(loadId, () => resolve([]));
      });
    }

    const session = new AgentSession({
      createModel: () => Promise.resolve(replyingModel()),
      createTools: (_metadata, loadId) => {
        toolsLoadIds.push(loadId);
        return {
          list: () => gatedList(loadId),
          execute: () => Promise.resolve({ ok: true, content: "" }),
          dispose: () => Promise.resolve(),
        };
      },
        filesTools: inPageToolPort([]),
      describeAttachedFiles: () => "no files attached",
      secrets: configSecretPort({}),
      permission: allowAllPermissions,
      emit: () => {},
    });

    async function flushUntil(predicate: () => boolean): Promise<void> {
      for (let i = 0; i < 50 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const loadA = session.load(VALID, undefined, "load-A");
    await flushUntil(() => toolsLoadIds.length === 1);
    const loadB = session.load(VALID, undefined, "load-B");
    await flushUntil(() => toolsLoadIds.length === 2);

    expect(toolsLoadIds).toEqual(["load-A", "load-B"]);

    gates.get("load-B")?.();
    await loadB;
    gates.get("load-A")?.();
    await loadA;

    expect(toolsLoadIds).toEqual(["load-A", "load-B"]);
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
    expect(emitted.filter((m) => m.type === "agent-ready")).toHaveLength(1);
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
      "check:active",
      "check:done",
    ]);
  });

  // Skills are not loaded by this runtime at all, so a file declaring them must not grow a
  // stage that never runs.
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
    expect(steps.some((s) => s.key === "check")).toBe(false);
  });
});

// "Try again" replaces the last answer, and the history it rebuilds has to stay well-formed:
// an assistant message carrying toolCalls must never survive without its tool results.
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

    // The retry starts from the same context the first attempt had: just the user's question.
    const retry = seen[seen.length - 1] ?? [];
    expect(retry).toEqual([{ role: "user", content: "what is it?" }]);

    // Nothing in the rebuilt request carries toolCalls without the matching tool messages.
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

    // Before this was fixed the old agent was still loaded, so the message went through.
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

    // The guard must not be sticky - once the turn ends the next send goes through.
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
