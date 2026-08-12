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

import { AgentSession } from "./session";
import { createPromptBridge, createPermissionBridge } from "./bridges";
import { modelFromMetadata } from "./model-factory";
import { toolsFromMetadata, defaultMcpProxyConfig, proxyAwareFetch } from "./tool-factory";
import { createOAuthManager } from "./oauth-manager";
import type { OAuthProviderRef } from "@afm/adapter-auth";
import { authorizationCodeRefreshKey } from "@afm/adapter-auth";
import { createWorkerSecretStore } from "./worker-secret-store";
import type { ClientMessage, ServerMessage } from "./protocol";
import { permissionKey } from "./protocol";
import { chainSecretPort, promptSecretPort } from "@afm/adapter-secret";
import { FILE_TOOL_NAMES, filesToolPort, listFilesText } from "@afm/adapter-tool";
import type { FileInfo } from "@afm/adapter-tool";
import type { AgentMetadata, PermissionBroker, ModelPort, SecretPort, ToolPort } from "@afm/engine";
import { scanSecretUsage, secretUseKey, describeError } from "@afm/engine";
import { destinationGatedVault, distinctHosts } from "./secret-gate";
import { resolveProbeAuth, probeToolUses } from "./probe-auth";
import { stripCodeFence, buildAfmSource } from "./draft-format";

/** How long the Add-a-server panel waits for a server to answer. */
const PROBE_TIMEOUT_MS = 12_000;

const scope = globalThis as unknown as {
  postMessage(message: ServerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ClientMessage>) => void): void;
};

const promptBridge = createPromptBridge((name) => scope.postMessage({ type: "secret-request", name }));

// Secret custody (in-memory plaintext, passkey unlock, sealing, auto-lock) lives in
// worker-secret-store.
const store = createWorkerSecretStore((message) => scope.postMessage(message));

// Lists a server's tools before the agent runs, through the same factory as a real run, so the
// Add-a-server panel can show what it would allow.
async function probeServer(probeId: string, server: AgentMetadata["tools"]): Promise<void> {
  let port: ToolPort | undefined;
  try {
    // Never prompts for an unsaved value: it stays unresolved. Scoped to this server's own uses,
    // not whichever agent last loaded, so an edited address asks about its own destination.
    const probeSecrets = gatedVault(askDestination, () => probeToolUses(server));
    port = toolsFromMetadata(
      { tools: await resolveProbeAuth(server, probeSecrets) },
      defaultMcpProxyConfig,
      { getInteractiveToken: makeGetInteractiveToken(probeId), onInteractiveAuthRejected },
      { setupTimeoutMs: PROBE_TIMEOUT_MS },
    );
    const tools = await port.list();
    scope.postMessage({
      type: "probe-result",
      id: probeId,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    });
  } catch (error) {
    scope.postMessage({ type: "probe-result", id: probeId, error: describeError(error) });
  } finally {
    void port?.dispose?.();
  }
}

// Destinations the user approved for a saved secret, and the tool-scoped uses declared by the agent
// being loaded.
let approvedSecretUses = new Set<string>();
let toolSecretUses: { name: string; host?: string }[] = [];

const approvalBridge = createPromptBridge((name) =>
  scope.postMessage({
    type: "secret-approval-request",
    name,
    hosts: pendingApprovalHosts.get(name) ?? [],
  }),
);
// Carries the hosts with the question; the bridge only knows names.
const pendingApprovalHosts = new Map<string, string[]>();

// A key already in memory is reused wherever the agent declares it, but only for destinations the
// user expected: an untrusted file could point the model key at a server of its own. So every value
// in memory passes the destination gate first. A value not yet typed is not gated (nothing to
// leak), which is why promptSecretPort stays outside it.
function gatedVault(
  askApproval: (name: string, hosts: (string | undefined)[]) => Promise<boolean>,
  toolUses: () => { name: string; host?: string }[] = () => toolSecretUses,
): SecretPort {
  return destinationGatedVault(chainSecretPort(store.memoryPort, store.passkeyPort), {
    toolUses,
    approved: () => approvedSecretUses,
    approve: (uses) => {
      for (const use of uses) approvedSecretUses.add(secretUseKey(use.name, use.host));
    },
    // A sealed copy counts as saved, so the gate asks about the destination before the unlock.
    isSaved: (name) => store.isSaved(name),
    askApproval,
  });
}

async function askDestination(name: string, hosts: (string | undefined)[]): Promise<boolean> {
  pendingApprovalHosts.set(name, distinctHosts(hosts));
  try {
    return (await approvalBridge.ask({ prefix: "", name, raw: "" })) !== null;
  } finally {
    pendingApprovalHosts.delete(name);
  }
}

const secrets = chainSecretPort(gatedVault(askDestination), promptSecretPort(promptBridge.ask));

async function resolveAuthoringModel(model: AgentMetadata["model"]): Promise<ModelPort> {
  const rawKey = model?.authentication?.api_key;
  const placeholder = typeof rawKey === "string" ? /^\$\{(?:env:)?([^}]+)\}$/.exec(rawKey) : null;
  if (placeholder === null) {
    return modelFromMetadata(model);
  }
  const name = placeholder[1]!;
  const resolution = await secrets.resolve({ prefix: "env", name, raw: rawKey! });
  if (resolution.status !== "resolved") {
    throw new Error(`Missing an API key for ${name}.`);
  }
  return modelFromMetadata({
    ...model,
    authentication: { ...model?.authentication, type: model?.authentication?.type ?? "api-key", api_key: resolution.value },
  });
}

type DraftResult = { kind: "draft"; source: string } | { kind: "clarify"; questions: string[] };

async function generateDraft(promptText: string, model: AgentMetadata["model"], final: boolean): Promise<DraftResult> {
  const modelPort = await resolveAuthoringModel(model);
  const provider = (model?.provider ?? "openai").toLowerCase();
  const modelName = model?.name ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o");
  const secretName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const fileSpec =
    "When you're ready to generate, reply with ONLY this - no YAML, no frontmatter, no code " +
    "fences, no commentary. The app builds the file's technical header (model, provider, " +
    "authentication, interface) itself from fixed values; you never write it and never " +
    "mention it:\n" +
    "NAME: <a short agent name>\n\n" +
    "# Role\n<1-2 sentences describing what the agent is>\n\n" +
    "# Instructions\n<clear, step-by-step instructions for what it should do>";
  const instruction = final
    ? "You write AFM agent files. The user has already answered your follow-up questions " +
      `below - do not ask any more questions, under any circumstances. ${fileSpec}\n\n` +
      `Request: ${promptText}`
    : "You write AFM agent files. First decide: is this request specific enough to write a " +
      "genuinely useful agent (clear purpose, tone, and what it should and shouldn't do)? " +
      "Only ask about the agent's purpose, behavior, tone, or content/domain needs - never " +
      "about the AI model, provider, or interface, since those are fixed by the app, not " +
      'something you or the user decide here. If something important is missing, reply with ' +
      'ONLY this JSON and nothing else: {"clarify": ["question 1", "question 2"]} - 1 to 3 ' +
      "short, concrete questions.\n" +
      `Otherwise, ${fileSpec}\n\n` +
      `Request: ${promptText}`;
  const controller = new AbortController();
  let text = "";
  for await (const event of modelPort.stream(
    { system: "", messages: [{ role: "user", content: instruction }], tools: [] },
    controller.signal,
  )) {
    if (event.type === "text-delta") text += event.text;
  }
  const cleaned = stripCodeFence(text);
  if (!final && cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned) as { clarify?: unknown };
      if (Array.isArray(parsed.clarify) && parsed.clarify.every((q) => typeof q === "string")) {
        return { kind: "clarify", questions: parsed.clarify };
      }
    } catch {
      // Not the clarify shape; treat the reply as a draft.
    }
  }
  return { kind: "draft", source: buildAfmSource(cleaned, provider, modelName, secretName) };
}

const permissionBridge = createPermissionBridge((call) =>
  scope.postMessage({
    type: "permission-request",
    id: call.id,
    name: call.name,
    args: call.args,
    serverId: call.serverId,
  }),
);

const alwaysAllow = new Set<string>();
const permission: PermissionBroker = {
  async request(call, signal) {
    const key = permissionKey(call.serverId, call.name);
    if (alwaysAllow.has(key)) {
      return "allow";
    }
    const decision = await permissionBridge.ask(call, signal);
    if (decision.allow && decision.remember) {
      alwaysAllow.add(key);
    }
    return decision.allow ? "allow" : "deny";
  },
};

const attachedFiles = new Map<string, FileInfo>();
const filesPort = filesToolPort(attachedFiles);

// The one redirect URI registered in client-metadata.json; the popup lands here and main.tsx relays
// the code.
const OAUTH_REDIRECT_URI = `${self.location.origin}/`;

const oauth = createOAuthManager({
  fetchFn: (input, init) => proxyAwareFetch()(input, init),
  redirectUri: OAUTH_REDIRECT_URI,
  refreshStore: store.refreshStore,
  loadSealedRefresh: (refreshKey) => store.loadSealedRefresh(refreshKey),
  emitAuthorizeUrl: (id, url) => scope.postMessage({ type: "oauth-authorize-url", id, url }),
  emitSignInResult: (id, ok, error) => scope.postMessage({ type: "oauth-signin-done", id, ok, error }),
});

function makeGetInteractiveToken(loadId: string): (provider: OAuthProviderRef) => Promise<string> {
  return (provider) => oauth.getAccessToken(provider, () => scope.postMessage({ type: "oauth-signin-needed", provider, loadId }));
}

function onInteractiveAuthRejected(provider: OAuthProviderRef): void {
  oauth.signOut(provider);
}

const session = new AgentSession({
  createModel: modelFromMetadata,
  createTools: (metadata, loadId) =>
    toolsFromMetadata(
      metadata,
      defaultMcpProxyConfig,
      {
        getInteractiveToken: makeGetInteractiveToken(loadId),
        onInteractiveAuthRejected,
      },
      {
        onServerProgress: (name, state, note) =>
          scope.postMessage({ type: "load-step", key: `mcp:${name}`, label: `Connecting to ${name}`, state, note }),
      },
    ),
  filesTools: filesPort,
  describeAttachedFiles: () => listFilesText(attachedFiles),
  secrets,
  permission,
  emit: (message) => scope.postMessage(message),
});

scope.addEventListener("message", (event) => {
  const message = event.data;
  store.touch();
  switch (message.type) {
    case "load":
      // Set before session.load, which resolves variables.
      toolSecretUses = scanSecretUsage(message.content)
        .filter((usage) => usage.scope === "tool")
        .map((usage) => ({ name: usage.name, host: usage.host }));
      approvedSecretUses = new Set();
      alwaysAllow.clear();
      for (const name of message.permissionSeed ?? []) alwaysAllow.add(name);
      for (const name of FILE_TOOL_NAMES) alwaysAllow.add(permissionKey(undefined, name));
      attachedFiles.clear();
      void session.load(message.content, message.seedHistory, message.loadId);
      break;
    case "attach-files":
      for (const file of message.files) {
        attachedFiles.set(file.path, file);
      }
      break;
    case "detach-file":
      attachedFiles.delete(message.path);
      break;
    case "send":
      void session.send(message.text, message.images);
      break;
    case "regenerate":
      void session.regenerate();
      break;
    case "reset-chat":
      session.resetChat();
      break;
    case "cancel":
      session.cancel();
      break;
    case "secret-response":
      // A null value is a declined prompt, not a secret.
      if (message.value !== null) store.set(message.name, message.value);
      promptBridge.resolve(message.name, message.value);
      break;
    // The main thread ran the ceremony; this is only the decryption it cannot do.
    case "unlock-secret":
      store.acceptUnlock(message.name, message.key);
      break;
    case "set-secret":
      store.set(message.name, message.value);
      break;
    case "secret-approval-response":
      approvalBridge.resolve(message.name, message.approved ? "approved" : null);
      break;
    case "passkey-remember":
      store.seal(message.name, message.key, message.credentialId, message.salt);
      break;
    case "passkey-reseal":
      store.reseal(message.name, message.from, message.to, message.credentialId, message.salt);
      break;
    case "passkey-unlock-response":
      store.resolveUnlock(message.id, message.key);
      break;
    case "passkey-forget":
      store.forgetSealed(message.name);
      break;
    case "list-passkeys":
      store.postSealedNames();
      break;
    case "list-secrets":
      store.postNames();
      break;
    case "remove-secret":
      store.remove(message.name);
      break;
    case "permission-response":
      permissionBridge.resolve(message.id, {
        allow: message.decision === "allow",
        remember: message.remember,
      });
      break;
    case "oauth-signin-start":
      void oauth.startSignIn(message.id, message.provider);
      break;
    case "oauth-signin-code":
      void oauth.completeSignIn(message.id, message.code, message.state, message.iss);
      break;
    case "oauth-sign-out":
      oauth.signOut(message.provider);
      store.forgetSealed(authorizationCodeRefreshKey(message.provider));
      break;
    case "probe-server": {
      void probeServer(message.id, message.server);
      break;
    }
    case "generate-draft":
      void generateDraft(message.prompt, message.model, message.final ?? false)
        .then((result) => {
          if (result.kind === "clarify") {
            scope.postMessage({ type: "draft-clarify", questions: result.questions });
          } else {
            scope.postMessage({ type: "draft-generated", source: result.source });
          }
        })
        .catch((error) => scope.postMessage({ type: "draft-generation-error", message: describeError(error) }));
      break;
  }
});
