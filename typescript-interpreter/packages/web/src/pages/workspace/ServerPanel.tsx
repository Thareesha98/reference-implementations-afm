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

import { useEffect, useState } from "react";
import { referencedSecretNames } from "@afm/engine";
import type { AgentMetadata } from "@afm/engine";
import type { ProbeResult } from "../../worker-client/useStandaloneSession";
import { addMcpServer, removeMcpServer, setServerToolFilter } from "./agent-source-edit";
import { captureAuthSecrets, credentialNeed, isSecretAuthField, secretFieldState } from "./mcp-secret-fields";
import type { NewMcpServer } from "./agent-source-edit";
import type { ToolInfo } from "../../protocol";
import { discoverMcpServerAuth } from "../../mcp-servers";
import { ToolTip, tipFor } from "./ToolTip";
import type { TipTarget } from "./ToolTip";
import { ApprovalStep } from "./SetupSteps";
import { AuthFields, ServerTools } from "./server-panel-sections";
import { ServerDirectory } from "./ServerDirectory";
import { ServerDetail } from "./ServerDetail";
import type { DirectoryEntry } from "../../mcp-servers";
import { authorizationCodeRefreshKey, type OAuthProviderRef } from "@afm/adapter-auth";

interface Props {
  content: string;
  editing: string | null;
  metadata: AgentMetadata;
  onApply: (content: string) => void;
  /**
   * Ticking a tool is the user allowing the agent to use it; recording that as a standing
   * permission stops the chat asking again. An unticked tool loses its permission.
   */
  onSetAllowedTools: (content: string, serverUrl: string, tools: string[]) => void;
  /** The server at this address is no longer in the file, so nothing allowed for it stays allowed. */
  onServerDropped: (serverUrl: string) => void;
  onProbe: (server: NonNullable<AgentMetadata["tools"]>) => Promise<ProbeResult>;
  /**
   * Starts an interactive sign-in on this same click, never through a probe that hopes something
   * else will pick it up.
   */
  onSignIn: (provider: OAuthProviderRef, remember: boolean) => Promise<boolean> | void;
  /**
   * Drops the session this server's Sign in obtained (access and refresh tokens). Never touches the
   * agent file.
   */
  onSignOut: (provider: OAuthProviderRef) => void;
  toolCache: Record<string, ToolInfo[]>;
  onToolsFound: (serverUrl: string, tools: ToolInfo[] | null) => void;
  onClose: () => void;
  /**
   * Files a credential where the model key goes, so the agent file only holds a `${env:NAME}`
   * reference. Resolves true when it was also sealed on the device.
   */
  onStoreSecret: (name: string, value: string, saveOnDevice: boolean) => Promise<boolean>;
  knownSecrets: string[];
  /**
   * Sealed on disk but not open in this tab: after a reload only the user's authenticator can bring
   * the key back.
   */
  lockedSecrets: string[];
  onUnlockSecret: (name: string) => Promise<boolean> | void;
  /**
   * A saved secret is only released to a destination the user agreed to. Checking this server can
   * raise that question, so it is answered here.
   */
  pendingApproval: { name: string; hosts: string[] } | null;
  onDecideApproval: (name: string, approved: boolean) => void;
  passkeyUsable: boolean;
}

interface Method {
  id: string;
  label: string;
  fields: { key: string; name: string; hint: string; placeholder: string }[];
}

const METHODS: Method[] = [
  { id: "none", label: "None", fields: [] },
  { id: "bearer", label: "Access token", fields: [{ key: "token", name: "token", hint: "required", placeholder: "${env:MY_TOKEN}" }] },
  {
    id: "basic",
    label: "Username",
    fields: [
      { key: "username", name: "username", hint: "required", placeholder: "your username" },
      { key: "password", name: "password", hint: "required", placeholder: "${env:MY_PASSWORD}" },
    ],
  },
  {
    id: "api-key",
    label: "Key in a header",
    fields: [
      { key: "api_key", name: "api key", hint: "required", placeholder: "${env:MY_API_KEY}" },
      { key: "header_name", name: "header name", hint: "optional", placeholder: "X-API-Key" },
    ],
  },
  {
    id: "oauth2",
    label: "Provider sign-in",
    fields: [
      { key: "authorize_url", name: "authorize url", hint: "required", placeholder: "https://…/oauth/authorize" },
      { key: "token_url", name: "token url", hint: "required", placeholder: "https://…/oauth/token" },
      { key: "client_id", name: "client id", hint: "required", placeholder: "${env:MY_CLIENT_ID}" },
      { key: "scopes", name: "scopes", hint: "optional", placeholder: "mcp" },
    ],
  },
];

/**
 * A server's name is not asked for: it is the recognisable part of its address, and only exists so
 * the file can refer to the server.
 */
export function nameFromUrl(url: string, taken: string[]): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  const parts = host.split(".").filter((part) => !["mcp", "api", "www"].includes(part));
  const base = (parts[0] ?? host).replace(/[^a-z0-9-]/gi, "").toLowerCase() || "server";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
}

// Said only when true, so a panel that gave up or never asked does not look busy forever.
function waitingNote(
  url: string,
  probing: boolean,
  error: string | null,
  need: "none" | "locked" | "missing" | "signin",
): string {
  if (probing) return "Checking the address…";
  if (url.trim() === "") return "Enter the address and its tools are listed here.";
  if (need === "locked") return "Unlock the saved credential above to list this server's tools.";
  if (need === "missing") return "This server needs its credential. Enter it above to list its tools.";
  if (need === "signin") return "Sign in above to list this server's tools.";
  if (error !== null) return "No tools listed. Fix the address or check again.";
  return "Press Check again to list this server's tools.";
}

export function ServerPanel({
  content,
  editing,
  metadata,
  onApply,
  onSetAllowedTools,
  onServerDropped,
  onProbe,
  onSignIn,
  onSignOut,
  toolCache,
  onToolsFound,
  onClose,
  onStoreSecret,
  knownSecrets,
  lockedSecrets,
  onUnlockSecret,
  pendingApproval,
  onDecideApproval,
  passkeyUsable,
}: Props) {
  const existing = (metadata.tools?.mcp ?? []).find((server) => server.name === editing);
  const existingUrl = existing?.transport.type === "http" ? existing.transport.url : "";
  // This panel only writes http servers; saving a command-based one would rewrite it as a URL and
  // lose the command, so it is shown read-only.
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
  const [found, setFound] = useState<ToolInfo[] | null>(toolCache[existingUrl] ?? null);
  const [probedUrl, setProbedUrl] = useState(toolCache[existingUrl] === undefined ? "" : existingUrl);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<string[]>(existing?.tool_filter?.allow ?? []);
  const [tip, setTip] = useState<TipTarget | null>(null);
  const [tab, setTab] = useState<"directory" | "url">("directory");
  const [pendingDirectoryProbe, setPendingDirectoryProbe] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [detail, setDetail] = useState<DirectoryEntry | null>(null);
  const [oauthFormOpen, setOauthFormOpen] = useState(false);
  const [rememberOAuth, setRememberOAuth] = useState(false);
  // Per field: absent = keep the file's value, "" = cleared, else a new value.
  const [secretEdits, setSecretEdits] = useState<Record<string, string>>({});
  const [saveOnDevice, setSaveOnDevice] = useState(false);

  const showTip = (tool: ToolInfo, row: HTMLElement) => {
    const body = (tool.description ?? "").trim();
    if (body === "") return;
    setTip(tipFor(tool.name, body, row.getBoundingClientRect()));
  };
  const hideTip = () => setTip(null);

  const chosen = METHODS.find((m) => m.id === method) ?? METHODS[0]!;
  // Only the methods above can be written; saving over another method would rewrite its block and
  // lose what it says.
  const writesMethod = METHODS.some((option) => option.id === method);

  const fieldState = (fieldKey: string) =>
    secretFieldState(values[fieldKey] ?? "", secretEdits[fieldKey], knownSecrets, lockedSecrets);
  const secretStored = (fieldKey: string) => fieldState(fieldKey) === "saved";
  const secretLocked = (fieldKey: string) => fieldState(fieldKey) === "locked";

  // The first probe waits until the credential is reachable, so it never fails as "Unauthorized".
  const need = credentialNeed(chosen.fields.map((field) => fieldState(field.key)));
  const scopeList = (values.scopes ?? "").split(/[\s,]+/).filter((scope) => scope !== "");
  const oauthRefreshKey = authorizationCodeRefreshKey(oauthProvider());
  const signInNeeded = method === "oauth2" && !knownSecrets.includes(oauthRefreshKey);
  const oauthLocked = method === "oauth2" && lockedSecrets.includes(oauthRefreshKey);
  const storedNeed = credentialNeed(
    chosen.fields.map((field) =>
      secretFieldState(values[field.key] ?? "", undefined, knownSecrets, lockedSecrets),
    ),
  );
  const credentialReady = method === "oauth2" ? !signInNeeded && !oauthLocked : storedNeed === "none";

  useEffect(() => {
    if (credentialReady && existingUrl !== "" && toolCache[existingUrl] === undefined) void probe();
    // probe is redefined every render; the credentials becoming ready decides when to run.
  }, [credentialReady]);

  const taken = (metadata.tools?.mcp ?? []).map((s) => s.name).filter((n) => n !== editing);
  const name = editing ?? nameFromUrl(url, taken);

  // Runs once the address from a Directory pick has landed and `name` is re-derived; probing off
  // the stale pre-click `url` would ask about nothing.
  useEffect(() => {
    if (!pendingDirectoryProbe) return;
    setPendingDirectoryProbe(false);
    void probe(true);
    // probe is redefined every render; the flag decides when to run.
  }, [pendingDirectoryProbe]);

  function connectFromDirectory(entry: DirectoryEntry) {
    setUrl(entry.url);
    setTab("url");
    // Clear the last pick's state, or discovery (which only runs from "none") never fires. A server
    // that needs a key lands on that field.
    setMethod(entry.needsKey ? "bearer" : "none");
    setValues({});
    setFound(null);
    setError(null);
    setProbedUrl("");
    setAllowed([]);
    if (!entry.needsKey) setPendingDirectoryProbe(true);
  }

  const hasTypedSecret = chosen.fields.some(
    (field) => isSecretAuthField(field.key) && (secretEdits[field.key] ?? "").trim() !== "",
  );

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

  /**
   * The same provider identity Sign in and Sign out both use, so signing out reaches the session
   * signing in created.
   */
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
    if (!force && url.trim() === probedUrl) return;
    setProbing(true);
    setError(null);

    // From "none" only: discover whether the server needs sign-in, never overriding a chosen
    // method.
    const auth = authBlock();
    if (method === "none") {
      const discovered = await discoverMcpServerAuth(url.trim()).catch(() => null);
      if (discovered !== null) {
        setMethod("oauth2");
        setValues({
          authorize_url: discovered.authorizeUrl,
          token_url: discovered.tokenUrl,
          client_id: discovered.clientId,
          ...(discovered.scopes !== undefined && discovered.scopes.length > 0 ? { scopes: discovered.scopes.join(" ") } : {}),
        });
        // Don't probe a just-discovered oauth2 config: nobody has signed in, so it would only time
        // out.
        setProbing(false);
        return;
      }
    }

    const result = await onProbe({
      mcp: [
        {
          name,
          transport: {
            type: "http",
            url: url.trim(),
            // Sent exactly as it will be written to the file, so the list is what the agent can
            // reach.
            ...(auth === undefined
              ? {}
              : { authentication: { type: auth.type, ...auth.fields, ...(auth.scopes ? { scopes: auth.scopes } : {}) } }),
          },
        },
      ],
    });
    setProbing(false);
    if (result.error !== undefined) {
      setError(result.error);
      onToolsFound(url.trim(), null);
      return;
    }
    const tools: ToolInfo[] = (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    setFound(tools);
    setProbedUrl(url.trim());
    onToolsFound(url.trim(), tools);
    // Only preselect everything for a server being added; reopening one must not undo a tool the
    // user turned off.
    if (editing === null) setAllowed(tools.map((tool) => tool.name));
  }

  function toggle(tool: string) {
    setAllowed((current) => (current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool]));
  }

  function save() {
    if (name === "") return;
    let next = editing === null ? content : removeMcpServer(content, editing);
    // Read after the old block is gone, so re-saving a server can reuse its own name. Names
    // already held on the device count too, so two agents never end up sharing one captured name.
    const taken = [...referencedSecretNames(next), ...knownSecrets, ...lockedSecrets];
    const auth = authBlock();
    const captured =
      auth === undefined ? undefined : captureAuthSecrets(name, auth.fields, taken);
    next = addMcpServer(next, {
      name,
      url: url.trim(),
      auth: auth === undefined || captured === undefined ? undefined : { ...auth, fields: captured.fields },
    });
    if (found !== null) next = setServerToolFilter(next, name, allowed);
    for (const secret of captured?.secrets ?? []) {
      void onStoreSecret(secret.name, secret.value, saveOnDevice && passkeyUsable);
    }
    onApply(next);
    if (existingUrl !== "" && existingUrl !== url.trim()) onServerDropped(existingUrl);
    // Without a probe the file's filter was not rewritten, so an empty list means "not looked at",
    // not "none", and must not take any permission back.
    if (found !== null || allowed.length > 0) onSetAllowedTools(next, url.trim(), allowed);
    onClose();
  }

  const showDirectory = editing === null && tab === "directory";
  const showDetail = showDirectory && detail !== null;
  // A probe that found tools, with oauth2 still chosen and nothing wrong, is a working sign-in,
  // shown collapsed unless "Edit" asks for the fields.
  const signedIn = method === "oauth2" && found !== null && error === null;

  return (
    <>
      <div className="u-panel-body">
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
                {METHODS.map((option) => (
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
                      // What the last probe found belongs to the ended session; left on screen it
                      // would read as still connected.
                      setFound(null);
                      setError(null);
                      setProbedUrl("");
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : oauthLocked && !oauthFormOpen ? (
                <div className="u-signedin-row">
                  <span className="u-chip warn">
                    <span className="u-dot" aria-hidden="true" />
                    locked
                  </span>
                  <button className="u-linkish" onClick={() => onUnlockSecret(oauthRefreshKey)}>
                    Unlock
                  </button>
                  <button className="u-linkish" onClick={() => setOauthFormOpen(true)}>
                    Sign in again
                  </button>
                </div>
              ) : (
                method !== "none" && (
                  <div className="u-auth-fields">
                    <AuthFields
                      fields={chosen.fields}
                      values={values}
                      secretEdits={secretEdits}
                      locked={secretLocked}
                      saved={secretStored}
                      onValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                      onSecretEdit={(key, value) => setSecretEdits((current) => ({ ...current, [key]: value }))}
                      onUnlock={onUnlockSecret}
                    />
                    {hasTypedSecret && (
                      <label className="u-checkline">
                        <input
                          type="checkbox"
                          checked={saveOnDevice && passkeyUsable}
                          disabled={!passkeyUsable}
                          onChange={(event) => setSaveOnDevice(event.target.checked)}
                        />
                        {passkeyUsable
                          ? "Save on this device, behind your fingerprint, Face or PIN"
                          : "This device cannot save it - kept for this tab only"}
                      </label>
                    )}
                    {method === "oauth2" && (
                      <div className="u-signin-row">
                        <button
                          className="u-btn primary"
                          onClick={() => {
                            void Promise.resolve(onSignIn(oauthProvider(), rememberOAuth && passkeyUsable)).then((ok) => {
                              if (ok === true) void probe(true);
                            });
                          }}
                        >
                          {signedIn ? "Sign in again" : "Sign in"}
                        </button>
                        <span className="u-row-meta">Opens the provider in a pop-up</span>
                        {passkeyUsable && (
                          <label className="u-checkline">
                            <input type="checkbox" checked={rememberOAuth} onChange={(event) => setRememberOAuth(event.target.checked)} />
                            <span>Remember me on this device</span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>

            {pendingApproval !== null && (
              <ApprovalStep
                name={pendingApproval.name}
                hosts={pendingApproval.hosts}
                onDecide={(approved) => onDecideApproval(pendingApproval.name, approved)}
              />
            )}

            <ServerTools
              url={url}
              probing={probing}
              found={found}
              error={error}
              allowed={allowed}
              waiting={waitingNote(url, probing, error, signInNeeded ? "signin" : need)}
              onToggle={toggle}
              onToggleAll={() => {
                if (found) setAllowed(allowed.length === found.length ? [] : found.map((tool) => tool.name));
              }}
              onCheckAgain={() => void probe(true)}
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
          <button className="u-btn primary" disabled={url.trim() === "" || name === "" || probing || isStdio || !writesMethod} onClick={save}>
            {probing ? "Checking…" : "Save"}
          </button>
        </div>
      )}
    </>
  );
}
