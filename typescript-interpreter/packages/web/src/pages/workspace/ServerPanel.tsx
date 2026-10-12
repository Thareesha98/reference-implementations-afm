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

import { useEffect, useRef, useState } from "react";
import type { AgentMetadata } from "@afm/engine";
import type { ProbeResult } from "../../worker-client/useStandaloneSession";
import { removeMcpServer } from "./agent-source-edit";
import { isSecretAuthField, lacksRequiredField, secretFieldState } from "./mcp-secret-fields";
import { AUTH_METHODS, nameFromUrl, prepareServerSave } from "./server-config";
import type { NewMcpServer } from "./agent-source-edit";
import type { ToolInfo } from "../../protocol";
import { discoverMcpServerAuth, resolveDirectoryClient } from "../../mcp-servers";
import type { DiscoveredMcpAuth } from "../../mcp-servers";
import { ToolTip, tipFor } from "./ToolTip";
import type { TipTarget } from "./ToolTip";
import { KeepOnDevice } from "./KeepOnDevice";
import { credentialOf, displayName, issueSentence, type Issue } from "./setup-check";
import { hostOf } from "../../load-paths";
import { AuthFields, ServerTools } from "./server-panel-sections";
import { ServerDirectory } from "./ServerDirectory";
import { ServerDetail } from "./ServerDetail";
import type { DirectoryEntry, OAuthSignIn } from "../../mcp-directory";
import { authorizationCodeRefreshKey, type OAuthProviderRef } from "@afm/adapter-auth";

interface Props {
  content: string;
  editing: string | null;
  metadata: AgentMetadata;
  onApply: (content: string) => void;
  onServerDropped: (serverUrl: string) => void;
  onProbe: (server: NonNullable<AgentMetadata["tools"]>) => Promise<ProbeResult>;
  onSignIn: (provider: OAuthProviderRef, keep: boolean) => Promise<boolean> | void;
  onSignOut: (provider: OAuthProviderRef) => void;
  onStoreSecret: (name: string, value: string, keep: boolean, host: string) => Promise<boolean>;
  knownSecrets: string[];
  issue: Issue | null;
  onBack?: () => void;
  onClose: () => void;
}

function signInValues(auth: OAuthSignIn, clientId = ""): Record<string, string> {
  return discoveredValues({ authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl, scopes: auth.scopes, clientId });
}

function discoveredValues(discovered: DiscoveredMcpAuth): Record<string, string> {
  return {
    authorize_url: discovered.authorizeUrl,
    token_url: discovered.tokenUrl,
    client_id: discovered.clientId,
    ...(discovered.scopes !== undefined && discovered.scopes.length > 0 ? { scopes: discovered.scopes.join(" ") } : {}),
  };
}

function waitingNote(
  url: string,
  probing: boolean,
  error: string | null,
  need: "none" | "missing" | "signin",
  unlisted: boolean,
): string {
  if (probing) return "Checking the address…";
  if (url.trim() === "") return "Enter the address and its tools are listed here.";
  if (need === "missing") return "This server needs its credential. Enter it above to list its tools.";
  if (need === "signin") return "Sign in above to list this server's tools.";
  if (error !== null) return "No tools listed. Fix the address or check again.";
  if (unlisted) return "This file does not list this server's tools, so every tool is allowed. Press Check again to choose which.";
  return "Press Check again to list this server's tools.";
}

export function ServerPanel({
  content,
  editing,
  metadata,
  onApply,
  onServerDropped,
  onProbe,
  onSignIn,
  onSignOut,
  onClose,
  onStoreSecret,
  knownSecrets,
  issue,
  onBack,
}: Props) {
  const existing = (metadata.tools?.mcp ?? []).find((server) => server.name === editing);
  const existingUrl = existing?.transport.type === "http" ? existing.transport.url : "";
  const isStdio = existing !== undefined && existing.transport.type === "stdio";
  const existingAuth = existing?.transport.type === "http" ? existing.transport.authentication : undefined;

  const [url, setUrl] = useState(existingUrl);
  const [method, setMethod] = useState(typeof existingAuth?.type === "string" ? existingAuth.type : "none");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const [key, value] of Object.entries(existingAuth ?? {})) {
      if (key === "type" || key === "grant_type") continue;
      seed[key] = Array.isArray(value) ? value.join(" ") : String(value ?? "");
    }
    return seed;
  });
  const [probing, setProbing] = useState(false);
  const [found, setFound] = useState<ToolInfo[] | null>(null);
  const [probedUrl, setProbedUrl] = useState("");
  const [error, setError] = useState<string | null>(issue?.text ?? null);
  const [rejected, setRejected] = useState(issue?.kind === "rejected");
  const [allowed, setAllowed] = useState<string[]>(existing?.tool_filter?.allow ?? []);
  const [tip, setTip] = useState<TipTarget | null>(null);
  const [tab, setTab] = useState<"directory" | "url">("directory");
  const [pendingDirectoryProbe, setPendingDirectoryProbe] = useState(false);
  const latestDirectoryPick = useRef(0);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [detail, setDetail] = useState<DirectoryEntry | null>(null);
  const [oauthFormOpen, setOauthFormOpen] = useState(false);
  const [secretEdits, setSecretEdits] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState(false);

  const showTip = (tool: ToolInfo, row: HTMLElement) => {
    const body = (tool.description ?? "").trim();
    if (body === "") return;
    setTip(tipFor(tool.name, body, row.getBoundingClientRect()));
  };
  const hideTip = () => setTip(null);

  const chosen = AUTH_METHODS.find((m) => m.id === method) ?? AUTH_METHODS[0]!;
  const writesMethod = AUTH_METHODS.some((option) => option.id === method);

  const fieldState = (fieldKey: string) => secretFieldState(values[fieldKey] ?? "", secretEdits[fieldKey], knownSecrets);
  const secretStored = (fieldKey: string) => fieldState(fieldKey) === "saved";
  const scopeList = (values.scopes ?? "").split(/[\s,]+/).filter((scope) => scope !== "");
  const signedIn = method === "oauth2" && (knownSecrets.includes(authorizationCodeRefreshKey(oauthProvider())) || (found !== null && error === null));
  const need = chosen.fields.some((field) => fieldState(field.key) === "missing") ? "missing" : method === "oauth2" && !signedIn ? "signin" : "none";

  const listed = existing?.tool_filter?.allow !== undefined;
  const denied = existing?.tool_filter?.deny ?? [];
  const live = editing === null || !listed || url.trim() !== existingUrl;
  const tools: ToolInfo[] | null = live ? found : [...(existing?.tool_filter?.allow ?? []), ...denied].map((tool) => ({ name: tool }));

  const taken = (metadata.tools?.mcp ?? []).map((s) => s.name).filter((n) => n !== editing);
  const name = editing ?? nameFromUrl(url, taken);

  useEffect(() => {
    if (!pendingDirectoryProbe) return;
    setPendingDirectoryProbe(false);
    void probe(true);
  }, [pendingDirectoryProbe]);

  async function prepareSignIn(auth: OAuthSignIn, pick: number) {
    setProbing(true);
    const { clientId } = await resolveDirectoryClient(auth);
    if (pick !== latestDirectoryPick.current) return;
    setValues(signInValues(auth, clientId));
    setProbing(false);
  }

  function connectFromDirectory(entry: DirectoryEntry) {
    const pick = ++latestDirectoryPick.current;
    setUrl(entry.url);
    setTab("url");
    setMethod(entry.auth.type);
    setValues(entry.auth.type === "oauth2" ? signInValues(entry.auth) : {});
    setFound(null);
    setError(null);
    setProbedUrl("");
    setAllowed([]);
    setProbing(false);
    if (entry.auth.type === "none") setPendingDirectoryProbe(true);
    if (entry.auth.type === "oauth2") void prepareSignIn(entry.auth, pick);
  }

  const hasTypedSecret = chosen.fields.some(
    (field) => isSecretAuthField(field.key) && (secretEdits[field.key] ?? "").trim() !== "",
  );

  const incomplete = lacksRequiredField(chosen.fields, authBlock());

  function authBlock(): NewMcpServer["auth"] {
    if (method === "none") return undefined;
    const fields: Record<string, string> = {};
    for (const field of chosen.fields) {
      if (field.key === "scopes") continue;
      const value = isSecretAuthField(field.key)
        ? secretEdits[field.key] ?? values[field.key]
        : values[field.key];
      if (value !== undefined && value.trim() !== "") fields[field.key] = value.trim();
    }
    if (method === "oauth2") fields.grant_type = "authorization_code";
    return { type: method, fields, scopes: scopeList.length > 0 ? scopeList : undefined };
  }

  function oauthProvider(): OAuthProviderRef {
    return {
      authorizeUrl: values.authorize_url ?? "",
      tokenUrl: values.token_url ?? "",
      clientId: values.client_id ?? "",
      scopes: scopeList,
      resource: url.trim(),
    };
  }

  async function probe(force = false) {
    if (!writesMethod || url.trim() === "" || name === "") return;
    if (!force && (!live || url.trim() === probedUrl)) return;
    setProbing(true);
    setError(null);

    const auth = authBlock();
    if (method === "none") {
      const discovered = await discoverMcpServerAuth(url.trim()).catch(() => null);
      if (discovered !== null) {
        setMethod("oauth2");
        setValues(discoveredValues(discovered));
        setProbing(false);
        return;
      }
    }

    const server = {
      name,
      transport: {
        type: "http" as const,
        url: url.trim(),
        ...(auth === undefined
          ? {}
          : { authentication: { type: auth.type, ...auth.fields, ...(auth.scopes ? { scopes: auth.scopes } : {}) } }),
      },
    };
    const result = await onProbe({ mcp: [server] });
    setProbing(false);
    setRejected(result.failure?.kind === "rejected");
    if (result.failure !== undefined) {
      setError(issueSentence(result.failure.kind, displayName(name), credentialOf(server), result.failure.message));
      return;
    }
    const reported = (result.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description }));
    setFound(reported);
    setProbedUrl(url.trim());
    if (live) setAllowed(reported.map((tool) => tool.name).filter((tool) => !denied.includes(tool)));
  }

  function toggle(tool: string) {
    setAllowed((current) => (current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool]));
  }

  function save() {
    if (name === "") return;
    const next = prepareServerSave({
      content,
      editing,
      server: { name, url: url.trim(), auth: authBlock() },
      knownSecrets,
      tools,
      allowed,
    });
    for (const secret of next.secrets) {
      void onStoreSecret(secret.name, secret.value, keep, hostOf(url.trim()));
    }
    onApply(next.content);
    if (existingUrl !== "" && existingUrl !== url.trim()) onServerDropped(existingUrl);
    onClose();
  }

  const showDirectory = editing === null && tab === "directory";
  const showDetail = showDirectory && detail !== null;
  return (
    <>
      <div className="u-panel-body">
        {onBack !== undefined && (
          <button className="u-detail-back is-near" onClick={onBack}>
            ← Back to Setup
          </button>
        )}
        {editing === null && !showDetail && (
          <div className="u-connect-head">
            <span className="u-seg fill">
              <button className={tab === "directory" ? "on" : ""} onClick={() => setTab("directory")}>
                Directory
              </button>
              <button className={tab === "url" ? "on" : ""} onClick={() => setTab("url")}>
                Add by URL
              </button>
            </span>
            {showDirectory && (
              <input
                className="u-input"
                placeholder="Search the directory"
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
              />
            )}
          </div>
        )}

        {showDetail ? (
          <ServerDetail
            entry={detail}
            onBack={() => setDetail(null)}
            onConnect={(entry) => {
              setDetail(null);
              connectFromDirectory(entry);
            }}
          />
        ) : showDirectory ? (
          <ServerDirectory query={directoryQuery} onConnect={connectFromDirectory} onInfo={setDetail} />
        ) : (
          <>
            {isStdio && (
              <p className="u-hint">
                This server runs a command on the machine rather than answering at a URL. Editing it
                here would turn it into a URL and lose the command, so open <strong>Raw</strong> to change it.
              </p>
            )}
            {!writesMethod && (
              <p className="u-hint">
                This server signs in with <code>{method}</code>, which this panel cannot edit. Choose a
                method below to replace it, or open <strong>Raw</strong> to change the file.
              </p>
            )}
            <label className="u-group">
              <span className="u-label">Address</span>
              <input
                className="u-input mono"
                value={url}
                placeholder="https://example.com/mcp"
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => void probe()}
                readOnly={isStdio}
              />
            </label>

            <div className="u-group">
              <span className="u-label">How it signs in</span>
              <div className="u-pills">
                {AUTH_METHODS.map((option) => (
                  <button
                    key={option.id}
                    className={`u-pill-btn ${method === option.id ? "on" : ""}`}
                    onClick={() => setMethod(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {signedIn && !oauthFormOpen ? (
                <div className="u-signedin-row">
                  <span className="u-chip ok">
                    <span className="u-dot" aria-hidden="true" />
                    Signed in
                  </span>
                  <button className="u-linkish" onClick={() => setOauthFormOpen(true)}>
                    Edit
                  </button>
                  <button
                    className="u-linkish"
                    onClick={() => {
                      onSignOut(oauthProvider());
                      setFound(null);
                      setError(null);
                      setProbedUrl("");
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                method !== "none" && (
                  <div className="u-auth-fields">
                    <AuthFields
                      fields={chosen.fields}
                      values={values}
                      secretEdits={secretEdits}
                      saved={secretStored}
                      rejected={rejected}
                      onValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                      onSecretEdit={(key, value) => setSecretEdits((current) => ({ ...current, [key]: value }))}
                      onSecretBlur={() => hasTypedSecret && void probe(true)}
                    />
                    {(hasTypedSecret || method === "oauth2") && <KeepOnDevice keep={keep} onChange={setKeep} />}
                    {method === "oauth2" && (
                      <div className="u-signin-row">
                        <button
                          className="u-btn primary"
                          disabled={incomplete}
                          onClick={() => {
                            void Promise.resolve(onSignIn(oauthProvider(), keep)).then((ok) => {
                              if (ok === true) void probe(true);
                            });
                          }}
                        >
                          Sign in
                        </button>
                        <span className="u-row-meta">Opens the provider in a pop-up</span>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>

            <ServerTools
              url={url}
              probing={probing}
              found={tools}
              error={error}
              allowed={allowed}
              waiting={waitingNote(url, probing, error, need, editing !== null && !listed)}
              onToggle={toggle}
              onToggleAll={() => {
                if (tools) setAllowed(allowed.length === tools.length ? [] : tools.map((tool) => tool.name));
              }}
              onCheckAgain={() => void probe(true)}
              checkable={live}
              showTip={showTip}
              hideTip={hideTip}
            />
          </>
        )}
      </div>

      <ToolTip tip={tip} />

      {!showDirectory && (
        <div className="u-panel-foot">
          {editing !== null && (
            <button
              className="u-btn danger"
              onClick={() => {
                onApply(removeMcpServer(content, editing));
                if (existingUrl !== "") onServerDropped(existingUrl);
                onClose();
              }}
            >
              Remove
            </button>
          )}
          <div className="u-spacer" />
          <button className="u-btn ghost" onClick={onClose}>Cancel</button>
          <button className="u-btn primary" disabled={url.trim() === "" || name === "" || isStdio || !writesMethod || incomplete} onClick={save}>
            Save
          </button>
        </div>
      )}
    </>
  );
}
