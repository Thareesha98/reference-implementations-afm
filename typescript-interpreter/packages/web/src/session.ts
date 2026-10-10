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

import { loadAfm, runAgentTurn, describeError } from "@afm/engine";
import type {
  LoadedAfm,
  AgentMetadata,
  ModelPort,
  ToolPort,
  SecretPort,
  PermissionBroker,
  ChatMessage,
  ContentPart,
} from "@afm/engine";
import { compositeToolPort } from "@afm/adapter-tool";
import type { ServerMessage, ImageAttachment } from "./protocol";
import { serverMessageFromLoopEvent } from "./protocol";

const MAX_TOKENS_PER_TURN = 250_000;
const MAX_WALL_CLOCK_MS = 180_000;

const STAGE_LABELS: Record<string, string> = {
  file: "Reading the agent file",
  model: "Connecting to the model",
  tools: "Preparing tools",
};

const FILES_SYSTEM_NOTE =
  "\n## Attached Files\n\n" +
  "The user may attach files (PDF, Markdown, or plain text) to this conversation - by dragging " +
  "them onto the message box or using the attach button. Use read_file to read one (paginated " +
  "for long documents - keep calling with the given offset for more), and search_files to find " +
  "relevant content across many files. Never assume file contents - always read them first. " +
  "What is attached is listed below and is accurate as of this message, so do not call " +
  "list_files to find out whether something is attached.\n";

export interface AgentSessionDeps {
  createModel: (model: AgentMetadata["model"]) => Promise<ModelPort>;
  createTools: (metadata: AgentMetadata) => ToolPort;
  filesTools: ToolPort;
  describeAttachedFiles: () => string;
  secrets: SecretPort;
  permission: PermissionBroker;
  emit: (message: ServerMessage) => void;
}

export class AgentSession {
  private loaded: LoadedAfm | null = null;
  private model: ModelPort | null = null;
  private tools: ToolPort | null = null;
  private history: ChatMessage[] = [];
  private controller: AbortController | null = null;
  private loadCount = 0;

  constructor(private readonly deps: AgentSessionDeps) {}

  // Each load stage reports when it starts and when it settles, so the loading screen shows real
  // progress. Skipped stages are never announced.
  private step(key: string, label: string, state: "active" | "done" | "failed", note?: string): void {
    this.deps.emit({ type: "load-step", key, label, state, note });
  }

  async load(content: string, seedHistory?: ChatMessage[]): Promise<void> {
    this.endTurn();
    // Loads can overlap; only the newest may install an agent or report on it.
    const number = ++this.loadCount;
    const current = (): boolean => number === this.loadCount;
    let stage = "file";
    try {
      this.step("file", "Reading the agent file", "active");
      const loaded = await loadAfm(content, this.deps.secrets);
      if (!current()) return;
      const blocked = loaded.plan.issues.find((issue) => issue.severity === "blocked");
      if (blocked !== undefined) throw new Error(blocked.message);
      this.step("file", "Reading the agent file", "done");

      stage = "model";
      const modelLabel = [loaded.metadata.model?.provider, loaded.metadata.model?.name]
        .filter((part) => part !== undefined && part !== "")
        .join(" · ");
      this.step("model", `Connecting to ${modelLabel === "" ? "the model" : modelLabel}`, "active");
      const model = await this.deps.createModel(loaded.metadata.model);
      if (!current()) return;
      this.step("model", `Connecting to ${modelLabel === "" ? "the model" : modelLabel}`, "done");

      stage = "tools";
      const mcpTools = this.deps.createTools(loaded.metadata);

      // `skills:` stays valid in a file, but this runtime does not load them.
      const tools = compositeToolPort([mcpTools, this.deps.filesTools]);
      const previousTools = this.tools;
      this.loaded = {
        ...loaded,
        systemPrompt: loaded.systemPrompt + FILES_SYSTEM_NOTE,
      };
      this.model = model;
      this.tools = tools;
      this.history = seedHistory ?? [];
      if (previousTools !== null) {
        void previousTools.dispose?.().catch(() => {});
      }
      this.deps.emit({
        type: "loaded",
        name: loaded.metadata.name ?? "AFM Agent",
        mcpServers: (loaded.metadata.tools?.mcp ?? []).map((server) => server.name),
        plan: loaded.plan,
      });
    } catch (error) {
      if (!current()) return;
      const reason = describeError(error);
      // The agent that was running is gone, so it must stop answering; otherwise a failed load
      // would report "not ready" while the previous agent kept serving.
      this.loaded = null;
      this.model = null;
      const staleTools = this.tools;
      this.tools = null;
      if (staleTools !== null) void staleTools.dispose?.().catch(() => {});
      this.step(stage, STAGE_LABELS[stage] ?? "Starting the agent", "failed", reason);
      this.deps.emit({ type: "agent-not-ready", reason });
      return;
    }
    if (this.tools !== null) {
      await this.selfTest(this.tools, current);
    }
  }

  private async selfTest(tools: ToolPort, current: () => boolean): Promise<void> {
    this.step("check", "Checking the agent is ready", "active");
    try {
      const descriptors = await tools.list();
      if (!current()) return;
      this.step("check", "Checking the agent is ready", "done");
      this.deps.emit({
        type: "agent-ready",
        toolCount: descriptors.length,
        tools: descriptors.map((d) => ({ name: d.name, description: d.description, serverId: d.serverId })),
      });
    } catch (error) {
      if (!current()) return;
      this.step("check", "Checking the agent is ready", "failed", describeError(error));
      this.deps.emit({
        type: "agent-not-ready",
        reason: `Couldn't reach the agent's tools - ${describeError(error)}`,
      });
    }
  }

  async send(text: string, images?: ImageAttachment[], keep?: number): Promise<void> {
    const content: string | ContentPart[] =
      images !== undefined && images.length > 0
        ? [
            ...(text.trim() !== "" ? [{ type: "text" as const, text }] : []),
            ...images.map((image) => ({ type: "image" as const, data: image.data, mediaType: image.mediaType })),
          ]
        : text;
    await this.sendContent(content, keep);
  }

  private async sendContent(content: string | ContentPart[], keep?: number): Promise<void> {
    const loaded = this.loaded;
    const model = this.model;
    const tools = this.tools;
    if (loaded === null || model === null || tools === null) {
      this.deps.emit({ type: "error", message: "No agent loaded yet." });
      return;
    }

    // One turn at a time: overlapping sends would share the controller and overwrite each other's
    // history.
    if (this.controller !== null) {
      this.deps.emit({ type: "error", message: "This agent is still answering - wait for it to finish, or press Stop." });
      return;
    }

    if (keep !== undefined) this.history = this.history.slice(0, this.userTurnStart(keep));

    const controller = new AbortController();
    this.controller = controller;
    const current = (): boolean => this.controller === controller;
    const messages: ChatMessage[] = [...this.history, { role: "user", content }];

    try {
      for await (const event of runAgentTurn({
        system: `${loaded.systemPrompt}\n${this.deps.describeAttachedFiles()}\n`,
        messages,
        model,
        tools,
        permission: this.deps.permission,
        budget: {
          maxIterations: loaded.metadata.max_iterations,
          maxTokens: MAX_TOKENS_PER_TURN,
          maxWallClockMs: MAX_WALL_CLOCK_MS,
        },
        signal: controller.signal,
      })) {
        if (!current()) return;
        // Keep the loop's full record (tool calls and results) so the next question builds on it.
        if (event.type === "turn-complete") {
          this.history = event.messages;
        }
        const message = serverMessageFromLoopEvent(event);
        if (message !== null) {
          this.deps.emit(message);
        }
      }
    } catch (error) {
      if (current()) this.deps.emit({ type: "error", message: describeError(error) });
    } finally {
      // Cleared however the turn ended, so the next send is accepted and a later Stop cannot abort
      // a finished turn.
      if (current()) this.controller = null;
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  // Unlike cancel(), the turn may not report back: its conversation is gone.
  private endTurn(): void {
    this.controller?.abort();
    this.controller = null;
  }

  resetChat(): void {
    this.endTurn();
    this.history = [];
  }

  /**
   * Where the user last spoke. A turn that used tools ends with an assistant message and one `tool`
   * message per call, and cutting between them is rejected by OpenAI and Anthropic.
   */
  private lastUserIndex(): number {
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      if (this.history[i]?.role === "user") return i;
    }
    return -1;
  }

  private userTurnStart(count: number): number {
    const starts = this.history.flatMap((message, index) => (message.role === "user" ? [index] : []));
    return starts[count] ?? this.history.length;
  }

  async regenerate(): Promise<void> {
    const index = this.lastUserIndex();
    const previous = index === -1 ? undefined : this.history[index];
    if (previous === undefined || previous.role !== "user") {
      this.deps.emit({ type: "turn-finished", reason: "stop" });
      return;
    }
    // Drops everything from that message on, including tool traffic; sendContent adds the user
    // message back.
    this.history = this.history.slice(0, index);
    await this.sendContent(previous.content);
  }

}

