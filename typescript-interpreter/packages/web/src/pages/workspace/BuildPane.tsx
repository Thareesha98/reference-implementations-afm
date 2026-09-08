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

import { isInteractiveOAuth } from "@afm/adapter-auth";
import type { AgentMetadata } from "@afm/engine";
import { useState } from "react";
import { getSection, setSection } from "./agent-source-edit";
import { FocusEditor } from "./FocusEditor";
import { RichText } from "./RichText";
import { shortModelLabel, findProvider } from "./model-catalog";
import { ProviderMark } from "./ProviderMark";
import type { ActivityPhase, AgentActivity } from "./agent-activity";
import { markColour } from "./mark-colour";

type McpServer = NonNullable<NonNullable<AgentMetadata["tools"]>["mcp"]>[number];

interface Props {
  content: string;
  onChange: (content: string) => void;
  metadata: AgentMetadata;
  onOpenModel: () => void;
  onOpenServer: (name: string | null) => void;
  /** What the agent is doing now, so the diagram can show it. */
  activity: AgentActivity;
  /** Servers heard from, and ones tried and not reached. */
  reach: ServerReach;
  /** Progress through its budget for a running agent. */
  step?: { iteration: number; maxIterations: number } | null;
}

/** Evidence, not assumption: green means the server answered. */
export interface ServerReach {
  ok: string[];
  failed: string[];
}

// What the file says about a server; nothing here needs the agent to have run. Whether the address
// works is ServerReach's question.
function serverSummary(server: McpServer): { tools: string; state: "ready" | "sign-in" } {
  const allowed = server.tool_filter?.allow?.length;
  const auth = server.transport.type === "http" ? server.transport.authentication : undefined;
  return {
    tools: allowed === undefined ? "all tools" : `${allowed} tool${allowed === 1 ? "" : "s"}`,
    state: isInteractiveOAuth(auth) ? "sign-in" : "ready",
  };
}

/** A button rather than a click on the text: clicking into a field means place the cursor. */
function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="u-ico tiny" onClick={onClick} title="Write in a bigger window"
      aria-label="Write in a bigger window">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        aria-hidden="true">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
  );
}

function Step({ n }: { n: number | null }) {
  if (n === null) return null;
  return <span className="u-step">{n}</span>;
}

/** Green claims the address works, so it is only shown once something has answered from it. */
function nodeTone(state: "ready" | "sign-in", heard: "ok" | "failed" | "unknown"): string {
  if (heard === "failed") return "bad";
  if (state === "sign-in") return "";
  return heard === "ok" ? "ok" : "";
}

/**
 * The agent as it works: the brief decides, the model thinks, the servers are what it can reach.
 * The brief takes the middle and the only ring because writing it is most of the work.
 */
export function BuildPane({
  content,
  onChange,
  metadata,
  onOpenModel,
  onOpenServer,
  activity,
  reach,
  step: runStep = null,
}: Props) {
  const [focus, setFocus] = useState<"Role" | "Instructions" | null>(null);
  const { phase } = activity;
  const servers = metadata.tools?.mcp ?? [];
  const urlOf = (server: McpServer) => (server.transport.type === "http" ? server.transport.url : undefined);

  // A box lights up only while it does the work.
  const agentLive = phase === "incoming" || phase === "from-model" || phase === "from-tool";
  const modelLive = phase === "thinking" || phase === "answering";
  // Only the server being called lights up.
  const onServer = (server: McpServer, at: ActivityPhase) =>
    phase === at && activity.serverId !== undefined && urlOf(server) === activity.serverId;

  // out = away from the agent, back = towards it, so a round trip reads as one.
  const lead = (out: boolean, back: boolean, broken: boolean) =>
    `u-lead${out ? " live is-flowing" : ""}${back ? " live is-returning" : ""}${broken ? " broken" : ""}`;
  const brokenServer = (server: McpServer) => {
    const url = urlOf(server);
    return url !== undefined && activity.brokenServerIds.includes(url) && !onServer(server, "tool");
  };

  const heard = (server: McpServer): "ok" | "failed" | "unknown" => {
    const url = urlOf(server);
    if (url === undefined) return "unknown";
    if (reach.failed.includes(url)) return "failed";
    if (reach.ok.includes(url)) return "ok";
    return "unknown";
  };

  const modelName = metadata.model?.name ?? "";
  const modelLabel = modelName === "" ? "Choose a model" : shortModelLabel(modelName);

  // The diagram is the instructions: whatever is missing gets a number, in the order it should be
  // done, on the part that needs it.
  const role = getSection(content, "Role");
  const instructions = getSection(content, "Instructions");
  const write = (heading: string) => (text: string) => onChange(setSection(content, heading, text));

  const todo: string[] = [];
  if (role.trim() === "") todo.push("role");
  if (instructions.trim() === "") todo.push("instructions");
  if (modelName === "") todo.push("model");
  const step = (what: string) => {
    const at = todo.indexOf(what);
    return at === -1 ? null : at + 1;
  };

  return (
    <div className="u-flow">
      <div className="u-flow-mid">
        <div className={`u-brief ${agentLive ? "live" : ""}`}>
          <div className="u-field">
            <div className="u-field-head">
              <span className="u-field-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                </svg>
              </span>
              <span className="u-field-name">ROLE</span>
              <Step n={step("role")} />
              <span className="u-field-hint">{step("role") !== null ? "say who it is" : "who it is"}</span>
              <span className="u-field-tools">
                <ExpandButton onClick={() => setFocus("Role")} />
              </span>
            </div>
            <RichText
              className="u-field-text u-role"
              value={role}
              placeholder="You are a helpful assistant…"
              ariaLabel="Role"
              rewindOnBlur
              onChange={write("Role")}
            />
          </div>

          <div className="u-field grow">
            <div className="u-field-head">
              <span className="u-field-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                  aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h11" />
                </svg>
              </span>
              <span className="u-field-name">INSTRUCTIONS</span>
              <Step n={step("instructions")} />
              <span className="u-field-hint">
                {step("instructions") !== null ? "say how it should behave" : "how it should behave"}
              </span>
              <span className="u-field-tools">
                <ExpandButton onClick={() => setFocus("Instructions")} />
              </span>
            </div>
            <RichText
              className="u-field-text"
              value={instructions}
              placeholder="Answer clearly and keep replies short…"
              ariaLabel="Instructions"
              rewindOnBlur
              onChange={write("Instructions")}
            />
          </div>
        </div>
      </div>

      <div className="u-rail">
        {runStep !== null && (
          <div className="u-rail-top live" title="How many steps it may take on its own">
            step <b>{runStep.iteration}</b> of {runStep.maxIterations}
          </div>
        )}

        <div className="u-rail-row">
          <span
            className={lead(phase === "thinking", phase === "from-model" || phase === "answering", activity.modelBroken)}
          />
          <button
            className={`u-node ${modelLive ? "live" : ""} ${activity.modelBroken ? "bad" : ""}`}
            onClick={onOpenModel}
            title={activity.modelBroken ? `${modelName} - this call did not come back` : modelName}
          >
            <span className="u-mk" style={{ background: providerColour(metadata.model?.provider ?? "") }}>
              <ProviderMark provider={metadata.model?.provider ?? ""} size={14} />
            </span>
            <span className="u-node-body">
              <span className="u-node-name">{modelLabel}</span>
              <span className="u-node-sub">
                {step("model") !== null
                  ? "choose one"
                  : (findProvider(metadata.model?.provider ?? "")?.label ?? metadata.model?.provider ?? "")}
              </span>
            </span>
            <Step n={step("model")} />
          </button>
        </div>

        <div className="u-rail-gap" />
        <div className="u-rail-label">TOOLS</div>

        {servers.map((server, index) => {
          const summary = serverSummary(server);
          const state = heard(server);
          return (
            <div className="u-rail-row" key={server.name}>
              <span className={lead(onServer(server, "tool"), onServer(server, "from-tool"), brokenServer(server))} />
              <button
                className={`u-node ${nodeTone(summary.state, state)} ${onServer(server, "tool") ? "live" : ""}`}
                onClick={() => onOpenServer(server.name)}
              >
                <span className="u-mk" style={{ background: markColour(server.name) }}>
                  {server.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="u-node-body">
                  <span className="u-node-name">{server.name}</span>
                  <span className={`u-node-sub ${state === "failed" || brokenServer(server) ? "bad" : ""}`}>
                    {state === "failed" ? "can't reach it" : brokenServer(server) ? "no answer" : summary.tools}
                  </span>
                </span>
              </button>
              {index === 0 && (
                <button className="u-node-add-sm" onClick={() => onOpenServer(null)} title="Connect tools"
                  aria-label="Connect tools">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                    aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {servers.length === 0 && (
          <div className="u-rail-row">
            <span className="u-lead" />
            <button className="u-node add" onClick={() => onOpenServer(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true" width="13" height="13">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Connect tools
            </button>
          </div>
        )}
      </div>

      {focus !== null && (
        <FocusEditor
          title={focus}
          hint={focus === "Role" ? "who this agent is" : "how it should behave"}
          value={focus === "Role" ? role : instructions}
          placeholder={focus === "Role" ? "You are a helpful assistant" : "Answer clearly and keep replies short."}
          onChange={write(focus)}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}

/** Each provider's own colour, so the model is recognised before its name is read. */
function providerColour(provider: string): string {
  if (provider === "openai") return "#10A37F";
  if (provider === "anthropic") return "#C15F3C";
  return "var(--accent)";
}

