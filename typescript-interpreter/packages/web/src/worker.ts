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
import { createPermissionBridge } from "./bridges";
import { modelFromMetadata, checkModelFromMetadata } from "./model-factory";
import { mcpServerPort, toolsFromMetadata, defaultMcpProxyConfig, proxyAwareFetch } from "./tool-factory";
import { createOAuthManager } from "./oauth-manager";
import type { OAuthProviderRef } from "@afm/adapter-auth";
import { authorizationCodeRefreshKey } from "@afm/adapter-auth";
import { createWorkerSecretStore } from "./worker-secret-store";
import type { ClientMessage, ServerMessage } from "./protocol";
import { permissionKey } from "./protocol";
import { FILE_TOOL_NAMES, filesToolPort, listFilesText } from "@afm/adapter-tool";
import type { FileInfo } from "@afm/adapter-tool";
import type { AgentMetadata, PermissionBroker, ModelPort, SecretPort, ToolPort } from "@afm/engine";
import { scanSecretUsage, describeError } from "@afm/engine";
import { destinationGatedVault } from "./secret-gate";
import type { SecretUse } from "./secret-gate";
import { resolveProbeAuth, probeToolUses } from "./probe-auth";
import { failureOf, failureFromStatus, MissingCredentialError } from "./failure";
import { stripCodeFence, buildAfmSource } from "./draft-format";

/** How long a check waits for a server to answer. */
const PROBE_TIMEOUT_MS = 12_000;

const scope = globalThis as unknown as {
  postMessage(message: ServerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ClientMessage>) => void): void;
};

// Secret custody (in-memory plaintext, passkey sealing, the hosts a value was entered for) lives in
// worker-secret-store.
const store = createWorkerSecretStore((message) => scope.postMessage(message));

// The tool-scoped secret uses declared by the agent being loaded.
let toolSecretUses: SecretUse[] = [];

// A value in memory is reused wherever the agent declares it, but only for the destinations it was
// entered for: an untrusted file could point the model key at a server of its own.
function gatedVault(toolUses: () => SecretUse[] = () => toolSecretUses): SecretPort {
  return destinationGatedVault(store.memoryPort, { toolUses, approvedFor: store.approvedFor });
}

const secrets = gatedVault();

function signOutOAuth(provider: OAuthProviderRef): void {
  oauth.signOut(provider);
  store.forgetSealed(authorizationCodeRefreshKey(provider));
}

const oauthDeps = {
  getInteractiveToken: (provider: OAuthProviderRef) => oauth.getAccessToken(provider),
  onInteractiveAuthRejected: signOutOAuth,
};

// Lists a server's tools through the same factory as a real run, so the Add-a-server panel can show
// what it would allow and Setup can tell a server that answers from one that does not. Never opens
// a sign-in: a missing one is a result.
async function probeServer(probeId: string, server: AgentMetadata["tools"]): Promise<void> {
  let port: ToolPort | null = null;
  try {
    await store.opened();
    const resolved = await resolveProbeAuth(server, gatedVault(() => probeToolUses(server)));
    const entry = resolved?.mcp?.[0];
    port = entry === undefined ? null : mcpServerPort(entry, defaultMcpProxyConfig, oauthDeps, { setupTimeoutMs: PROBE_TIMEOUT_MS });
    const tools = (await port?.list()) ?? [];
    scope.postMessage({
      type: "probe-result",
      id: probeId,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    });
  } catch (error) {
    scope.postMessage({ type: "probe-result", id: probeId, failure: failureOf(error) });
  } finally {
    void port?.dispose?.();
  }
}

// Asks the provider whether it accepts the model's key, with a request that costs nothing.
async function probeModel(probeId: string, model: AgentMetadata["model"]): Promise<void> {
  try {
    const check = await checkModelFromMetadata(await withResolvedKey(model));
    scope.postMessage(
      check.ok
        ? { type: "probe-result", id: probeId }
        : { type: "probe-result", id: probeId, failure: { kind: failureFromStatus(check.status), message: `The provider answered ${check.status}.` } },
    );
  } catch (error) {
    scope.postMessage({ type: "probe-result", id: probeId, failure: failureOf(error) });
  }
}

async function withResolvedKey(model: AgentMetadata["model"]): Promise<AgentMetadata["model"]> {
  await store.opened();
  const rawKey = model?.authentication?.api_key;
  const placeholder = typeof rawKey === "string" ? /^\$\{(?:env:)?([^}]+)\}$/.exec(rawKey) : null;
  if (placeholder === null) return model;
  const name = placeholder[1]!;
  const resolution = await store.memoryPort.resolve({ prefix: "env", name, raw: rawKey! });
  if (resolution.status !== "resolved") throw new MissingCredentialError(name);
  return {
    ...model,
    authentication: { ...model?.authentication, type: model?.authentication?.type ?? "api-key", api_key: resolution.value },
  };
}

async function resolveAuthoringModel(model: AgentMetadata["model"]): Promise<ModelPort> {
  return modelFromMetadata(await withResolvedKey(model));
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
  emitAuthorizeUrl: (id, url) => scope.postMessage({ type: "oauth-authorize-url", id, url }),
  emitSignInResult: (id, ok, error) => scope.postMessage({ type: "oauth-signin-done", id, ok, error }),
});

const session = new AgentSession({
  createModel: modelFromMetadata,
  createTools: (metadata) => toolsFromMetadata(metadata, defaultMcpProxyConfig, oauthDeps),
  filesTools: filesPort,
  describeAttachedFiles: () => listFilesText(attachedFiles),
  secrets,
  permission,
  emit: (message) => scope.postMessage(message),
});

scope.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "load":
      // Set before session.load, which resolves variables.
      toolSecretUses = scanSecretUsage(message.content)
        .filter((usage) => usage.scope === "tool")
        .map((usage) => ({ name: usage.name, host: usage.host }));
      alwaysAllow.clear();
      for (const name of message.permissionSeed ?? []) alwaysAllow.add(name);
      for (const name of FILE_TOOL_NAMES) alwaysAllow.add(permissionKey(undefined, name));
      attachedFiles.clear();
      void store.opened().then(() => session.load(message.content, message.seedHistory));
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
      void session.send(message.text, message.images, message.keep);
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
    // The main thread ran the ceremony; this is only the decryption it cannot do.
    case "unlock-secret":
      store.acceptUnlock(message.name, message.key);
      break;
    case "set-secret":
      store.set(message.name, message.value, message.host);
      break;
    case "passkey-remember":
      store.seal(message.name, message.key, message.credentialId, message.salt);
      break;
    case "passkey-reseal":
      store.reseal(message.name, message.from, message.to, message.credentialId, message.salt);
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
      signOutOAuth(message.provider);
      break;
    case "probe-server":
      void probeServer(message.id, message.server);
      break;
    case "probe-model":
      void probeModel(message.id, message.model);
      break;
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
