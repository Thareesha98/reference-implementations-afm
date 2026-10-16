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
import { ToolNameError, compositeToolPort, namespacedToolName } from "@afm/adapter-tool";
import type { ServerMessage, ImageAttachment } from "./protocol";
import { permissionKey, serverMessageFromLoopEvent } from "./protocol";
import { userContent } from "./message-content";

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

function listedAsAllowed(metadata: AgentMetadata): Set<string> {
  const keys = new Set<string>();
  for (const server of metadata.tools?.mcp ?? []) {
    if (server.transport.type !== "http") continue;
    for (const name of server.tool_filter?.allow ?? []) keys.add(permissionKey(server.transport.url, namespacedToolName(server.name, name)));
  }
  return keys;
}

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
  private allowed = new Set<string>();
  private model: ModelPort | null = null;
  private tools: ToolPort | null = null;
  private history: ChatMessage[] = [];
  private controller: AbortController | null = null;
  private loadCount = 0;

  constructor(private readonly deps: AgentSessionDeps) {}

  private step(key: string, label: string, state: "active" | "done" | "failed", note?: string): void {
    this.deps.emit({ type: "load-step", key, label, state, note });
  }

  async load(content: string, seedHistory?: ChatMessage[]): Promise<void> {
    this.endTurn();
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

      const tools = compositeToolPort([mcpTools, this.deps.filesTools]);
      const previousTools = this.tools;
      this.loaded = {
        ...loaded,
        systemPrompt: loaded.systemPrompt + FILES_SYSTEM_NOTE,
      };
      this.allowed = listedAsAllowed(loaded.metadata);
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
      this.refuse(stage, error);
      return;
    }
    if (this.tools !== null) {
      await this.reportTools(this.tools, current);
    }
  }

  private refuse(stage: string, error: unknown): void {
    const reason = describeError(error);
    this.loaded = null;
    this.allowed = new Set();
    this.model = null;
    const staleTools = this.tools;
    this.tools = null;
    if (staleTools !== null) void staleTools.dispose?.().catch(() => {});
    this.step(stage, STAGE_LABELS[stage] ?? "Starting the agent", "failed", reason);
    this.deps.emit({ type: "agent-not-ready", reason });
  }

  private async reportTools(tools: ToolPort, current: () => boolean): Promise<void> {
    try {
      const descriptors = await tools.list();
      if (!current()) return;
      this.deps.emit({
        type: "tools-listed",
        tools: descriptors.map((d) => ({ name: d.name, description: d.description, serverId: d.serverId })),
      });
    } catch (error) {
      if (error instanceof ToolNameError && current()) this.refuse("tools", error);
    }
  }

  async send(text: string, images?: ImageAttachment[], keep?: number): Promise<void> {
    await this.sendContent(userContent(text, images), keep);
  }

  private async sendContent(content: string | ContentPart[], keep?: number): Promise<void> {
    const loaded = this.loaded;
    const model = this.model;
    const tools = this.tools;
    if (loaded === null || model === null || tools === null) {
      this.deps.emit({ type: "error", message: "No agent loaded yet." });
      return;
    }

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
        permission: this.permission,
        budget: {
          maxIterations: loaded.metadata.max_iterations,
          maxTokens: MAX_TOKENS_PER_TURN,
          maxWallClockMs: MAX_WALL_CLOCK_MS,
        },
        signal: controller.signal,
      })) {
        if (!current()) return;
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
      if (current()) this.controller = null;
    }
  }

  private readonly permission: PermissionBroker = {
    request: async (call, signal) =>
      this.allowed.has(permissionKey(call.serverId, call.name)) ? "allow" : this.deps.permission.request(call, signal),
  };

  cancel(): void {
    this.controller?.abort();
  }

  private endTurn(): void {
    this.controller?.abort();
    this.controller = null;
  }

  resetChat(): void {
    this.endTurn();
    this.history = [];
  }

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
    this.history = this.history.slice(0, index);
    await this.sendContent(previous.content);
  }

}

