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
import { useLocation, useSearchParams } from "react-router-dom";
import { EditorPane } from "./EditorPane";
import { ChatPane } from "./ChatPane";
import { WorkspaceBar } from "./WorkspaceBar";
import { SharePanel } from "./SharePanel";
import { SettingsPanel } from "./SettingsPanel";
import { InfoPanel } from "./InfoPanel";
import { AgentPicker } from "./AgentPicker";
import { ModelPanel } from "./ModelPanel";
import { ServerPanel } from "./ServerPanel";
import { SidePane } from "./SideWindow";
import { ChatHead, StatusPill, headerStatus } from "./ChatHead";
import { useStandaloneSession } from "../../worker-client/useStandaloneSession";
import { previewAgent, buildableAgent, collectAfmIssues } from "../../agent-validation";
import { readiness, serverNameByUrl } from "./readiness";
import { SetupPane } from "./SetupPane";
import { useSetup } from "./use-setup";
import { MODEL_ROW, reachOf, serverRowId } from "./setup-check";
import type { SetupRow } from "./setup-check";
import { StageFoot } from "./StageFoot";
import { useAgentActivity } from "./agent-activity";
import { StartHere } from "./StartHere";
import { TrustScreen } from "./TrustScreen";
import { LEFT_TITLE, NOTHING_OPEN, SIDE_TITLE, closePanel, openOver, openPanel, togglePanel } from "./workspace-view";
import type { LeftPanel, SideState, SidePanel } from "./workspace-view";
import { resolveContent } from "../../load-paths";
import { agentFileFetch } from "../../tool-factory";
import { EMPTY_TEMPLATE, initialContent, identityFor, openedFromLink } from "./workspace-content";
import { useAgentsLibrary } from "../../agents/AgentsLibraryContext";
import { useHistory } from "../../history/HistoryContext";
import { permissionScopeFor, grantsToRevoke } from "../../permissions-store";
import { permissionKey } from "../../protocol";
import { usePermissionsLedger } from "../../permissions/PermissionsLedgerContext";
import { agentBrief, getSection } from "./agent-source-edit";
import { useSettled } from "./use-settled";
import { useThemeContext } from "../../app/ThemeContext";

export function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const draftSource = (location.state as { draftSource?: string } | null)?.draftSource;
  const [content, setContent] = useState(() => initialContent(searchParams, location.hash, draftSource));
  const [savedContent, setSavedContent] = useState(() => initialContent(searchParams, location.hash, draftSource));
  const [agentId, setAgentId] = useState<string | null>(() => searchParams.get("agentId"));
  const [saveFailed, setSaveFailed] = useState(false);
  const [fileLoading, setFileLoading] = useState(() => searchParams.get("file") !== null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [nav, setNav] = useState<SideState>(() =>
    searchParams.get("view") === "chat" ? { open: "chat", under: [] } : NOTHING_OPEN,
  );
  const [left, setLeft] = useState<LeftPanel | null>(() =>
    searchParams.get("view") !== "chat" && identityFor(searchParams, location.hash, draftSource) === "blank"
      ? "start"
      : null,
  );
  const side = nav.open;
  const backToSetup = nav.under[nav.under.length - 1] === "setup";
  const [chatFull, setChatFull] = useState(() => searchParams.get("view") === "chat");
  const [trusted, setTrusted] = useState(() => !openedFromLink(searchParams, location.hash, draftSource));
  const [linkedFile, setLinkedFile] = useState<string | null>(null);
  const [serverEditing, setServerEditing] = useState<string | null>(null);
  const [rawRequest, setRawRequest] = useState(0);
  const permissions = usePermissionsLedger();
  const theme = useThemeContext();
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const contentRef = useRef(content);
  contentRef.current = content;
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const session = useStandaloneSession({
    permissionSeed: () =>
      permissionsRef.current
        .forAgent(permissionScopeFor(agentIdRef.current, contentRef.current))
        .filter((entry) => entry.rule === "auto-allow")
        .map((entry) => permissionKey(entry.serverId, entry.toolName)),
    onRememberPermission: (request, allow) =>
      permissionsRef.current.set(
        permissionScopeFor(agentIdRef.current, contentRef.current),
        request.name,
        allow ? "auto-allow" : "always-ask",
        request.serverId,
      ),
  });
  const activity = useAgentActivity(session.state);
  const library = useAgentsLibrary();
  const history = useHistory();
  const preview = previewAgent(content);
  const loadedIdentityRef = useRef(identityFor(searchParams, location.hash, draftSource));
  const readable = buildableAgent(content);
  const agentLabel = (readable.ok ? readable.metadata.name : undefined) ?? "Untitled agent";
  const agentIcon = readable.ok ? (readable.metadata.icon_url ?? "") : "";
  const settledContentForRead = useSettled(content);
  const setup = useSetup(session, readable.ok ? readable.metadata : null);
  const reached = reachOf(setup.rows);

  useEffect(() => {
    const nextIdentity = identityFor(searchParams, location.hash, draftSource);
    if (nextIdentity === loadedIdentityRef.current) return;
    loadedIdentityRef.current = nextIdentity;
    setTrusted(!openedFromLink(searchParams, location.hash, draftSource));
    setLinkedFile(null);
    const next = initialContent(searchParams, location.hash, draftSource);
    const nextId = searchParams.get("agentId");
    setContent(next);
    setSavedContent(next);
    setAgentId(nextId);
    session.clearAgent();
  }, [searchParams, location.hash, draftSource]);

  const fileParam = searchParams.get("file");
  useEffect(() => {
    if (fileParam === null) {
      setFileLoading(false);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    void resolveContent({ kind: "remote", url: fileParam }, agentFileFetch())
      .then((text) => {
        if (cancelled || text === null) return;
        setContent(text);
        setSavedContent(text);
        setAgentId(null);
        setLinkedFile(fileParam);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFileError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileParam]);

  const chatMessages = session.state.messages;
  const chatStatus = session.state.status;
  useEffect(() => {
    if (agentId === null || chatMessages.length === 0) return;
    if (chatStatus === "streaming" || chatStatus === "connecting") return;
    const existing = history.entries.find((entry) => entry.agentId === agentId);
    history.upsert({
      id: existing?.id ?? agentId,
      agentId,
      agentName: agentLabel,
      agentSource: content,
      messages: chatMessages,
      tokenCount: session.state.budget?.totalTokens ?? 0,
      startedAt: existing?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }, [agentId, chatMessages, chatStatus]);

  function persistToLibrary(source: string = content): { id: string | null; persisted: boolean } {
    if (!readable.ok) return { id: null, persisted: false };
    const result = library.save({
      id: agentId ?? undefined,
      name: readable.metadata.name ?? "Untitled agent",
      description: readable.metadata.description ?? "",
      source,
      origin: "blank",
    });
    if (result.persisted) setSavedContent(source);
    setSaveFailed(!result.persisted);
    if (agentId === null) {
      setAgentId(result.saved.id);
      loadedIdentityRef.current = result.saved.id;
      setSearchParams({ agentId: result.saved.id }, { replace: true });
    }
    return { id: result.saved.id, persisted: result.persisted };
  }

  const running = chatStatus !== "no-agent" && chatStatus !== "not-ready";
  const startedHere = chatStatus !== "no-agent" && session.state.agentSource === content;
  const failed = startedHere && chatStatus === "not-ready";
  const current = running && startedHere;
  const canRun = preview.ok && preview.plan.runnable && !current;

  const servers = readable.ok ? (readable.metadata.tools?.mcp ?? []) : [];
  const nameByUrl = serverNameByUrl(servers);
  const chatState = headerStatus(
    session.state.status,
    activity.phase,
    activity.serverId === undefined ? undefined : nameByUrl.get(activity.serverId),
  );

  const settledPreview = previewAgent(settledContentForRead);
  const readinessMetadata = settledPreview.ok ? settledPreview.metadata : readable.ok ? readable.metadata : null;
  const ready = readiness({
    role: getSection(settledContentForRead, "Role"),
    instructions: getSection(settledContentForRead, "Instructions"),
    metadata: readinessMetadata,
    issues: collectAfmIssues(settledContentForRead),
    status: session.state.status,
    current,
    failed,
    brokenServerIds: activity.brokenServerIds,
    serverNameByUrl: nameByUrl,
  });

  function revokeGrants(serverUrl: string) {
    const scope = permissionScopeFor(agentIdRef.current, contentRef.current);
    for (const entry of grantsToRevoke(permissions.forAgent(scope), serverUrl)) {
      permissions.set(scope, entry.toolName, "always-ask", serverUrl);
    }
  }

  function runAgent() {
    const { id } = persistToLibrary();
    const previous = id === null ? undefined : history.entries.find((entry) => entry.agentId === id);
    const rewritten = running && agentBrief(session.state.agentSource) !== agentBrief(content);
    session.loadContent(content, previous?.messages, { carryConversation: !rewritten });
    openSide("chat");
  }

  function openSetup() {
    setup.start();
    openSide("setup");
  }

  function configure(row: SetupRow) {
    if (row.kind === "server") setServerEditing(row.name);
    reveal(openOver(nav, row.kind === "model" ? "model" : "tools"));
  }

  const settledContent = useSettled(content, 700);
  useEffect(() => {
    if (settledContent === savedContent) return;
    if (!buildableAgent(settledContent).ok) return;
    persistToLibrary(settledContent);
  }, [settledContent, savedContent]);

  function show(next: SideState) {
    setNav(next);
    if (next.open !== "chat") setChatFull(false);
  }

  function reveal(next: SideState) {
    setLeft(null);
    show(next);
  }

  const openSide = (next: SidePanel) => reveal(openPanel(nav, next));
  const toggleSide = (next: SidePanel) => {
    const toggled = togglePanel(nav, next);
    if (toggled.open === next) reveal(toggled);
    else show(toggled);
  };
  const leavePanel = () => show(closePanel(nav));
  const closeSide = () => show(NOTHING_OPEN);

  const openLeft = (next: LeftPanel) => {
    setLeft(next);
    setChatFull(false);
  };
  const toggleLeft = (next: LeftPanel) => (left === next ? setLeft(null) : openLeft(next));
  const closeLeft = () => setLeft(null);

  const overPanel = side !== null && side !== "chat" ? side : null;
  const showTrust = !trusted && !fileLoading;
  const reachedServerIds = [
    ...new Set(
      session.state.tools.map((tool) => tool.serverId).filter((id): id is string => id !== undefined),
    ),
  ];

  return (
    <div className="workspace-shell">
      <WorkspaceBar
        agentName={agentLabel}
        saved={content === savedContent}
        saveFailed={saveFailed}
        canAct={preview.ok}
        canRun={canRun}
        running={running}
        onRun={openSetup}
        open={side}
        onToggle={toggleSide}
        agentsOpen={left === "agents"}
        onToggleAgents={() => toggleLeft("agents")}
        onToggleTheme={theme.toggle}
        dark={theme.resolved === "dark"}
      />

      {fileLoading && <div className="draft-banner">Loading the agent file…</div>}
      {fileError !== null && (
        <div className="draft-banner draft-banner-error">
          <span>Couldn't load that file: {fileError}</span>
        </div>
      )}

      <div
        className={`u-body ${side !== null ? "has-side" : ""} ${left !== null ? "has-left" : ""} ${
          chatFull ? "is-chat-full" : ""
        } ${showTrust ? "is-trust" : ""}`}
      >
        {showTrust && readable.ok && (
          <TrustScreen
            metadata={readable.metadata}
            source={content}
            savedSecrets={session.state.savedSecrets}
            fileUrl={linkedFile}
            onRun={() => {
              setTrusted(true);
              openSetup();
            }}
            onOpenBuilder={() => {
              setTrusted(true);
              setChatFull(false);
              closeSide();
            }}
          />
        )}
        <aside className="u-side-left" aria-hidden={left === null}>
          {left !== null && (
            <SidePane key={left} title={LEFT_TITLE[left]} onClose={closeLeft} flush={left === "agents"}>
              {left === "agents" && (
                <AgentPicker
                  currentId={agentId}
                  onPick={(saved) => {
                    closeLeft();
                    closeSide();
                    setSearchParams({ agentId: saved.id }, { replace: true });
                  }}
                  onNew={() => {
                    closeSide();
                    setSearchParams({}, { replace: true });
                    setContent(EMPTY_TEMPLATE);
                    setSavedContent(EMPTY_TEMPLATE);
                    setAgentId(null);
                    loadedIdentityRef.current = "blank";
                    session.clearAgent();
                    openLeft("start");
                  }}
                />
              )}
              {left === "start" && (
                <StartHere
                  state={session.state}
                  onUseSource={(source) => {
                    setContent(source);
                    setSavedContent(source);
                    setAgentId(null);
                    setSearchParams({}, { replace: true });
                    loadedIdentityRef.current = "blank";
                    session.clearAgent();
                    closeLeft();
                    closeSide();
                  }}
                  onBlank={closeLeft}
                  onGenerate={(prompt, model, final) => session.generateDraft(prompt, model, final)}
                  onSaveKey={session.storeSecret}
                  onDismissDraft={session.dismissDraft}
                />
              )}
            </SidePane>
          )}
        </aside>

        <div className="u-stage">
          <EditorPane
            content={content}
            onChange={setContent}
            activity={activity}
            reach={{ ok: [...new Set([...reached.ok, ...reachedServerIds])], failed: reached.failed }}
            onOpenModel={() => openSide("model")}
            onOpenServer={(name) => {
              setServerEditing(name);
              openSide("tools");
            }}
            showRaw={rawRequest}
            onOpenPanel={(panel) => openSide(panel)}
          />
          <StageFoot
            state={ready}
            onFix={(fix) => {
              if (fix === "raw") {
                setRawRequest((n) => n + 1);
                return;
              }
              openSide(fix);
            }}
          />
        </div>

        <div className="u-float-scrim" onClick={leavePanel} role="presentation" />

        <aside className="u-side" aria-hidden={side === null}>
          <SidePane
            title="Chat"
            heading={
              chatFull ? (
                <StatusPill status={chatState} />
              ) : (
                <ChatHead name={agentLabel} iconUrl={agentIcon} status={chatState} />
              )
            }
            onClose={closeSide}
            onExpand={chatFull ? undefined : () => setChatFull(true)}
            floating={chatFull}
            flush
          >
            <ChatPane
              session={session}
              serverNameByUrl={nameByUrl}
              onReplaceKey={() => openSide("model")}
              onRetry={openSetup}
              description={readable.ok ? (readable.metadata.description ?? "") : ""}
              role={getSection(content, "Role")}
              iconUrl={agentIcon}
            />
          </SidePane>

          {overPanel !== null && (
            <SidePane
              key={overPanel}
              over
              title={
                overPanel === "tools" && serverEditing !== null ? serverEditing : SIDE_TITLE[overPanel]
              }
              onClose={leavePanel}
              flush={overPanel === "model" || overPanel === "tools" || overPanel === "info" || overPanel === "share" || overPanel === "setup"}
            >
              {overPanel === "share" && <SharePanel agentSource={content} />}
              {overPanel === "settings" && (
                <SettingsPanel session={session} />
              )}
              {overPanel === "info" && (
                <InfoPanel
                  content={content}
                  metadata={readable.ok ? readable.metadata : null}
                  saved={library.agents.find((agent) => agent.id === agentId)}
                  onApply={setContent}
                  onClose={leavePanel}
                />
              )}
              {overPanel === "setup" && (
                <SetupPane
                  rows={setup.rows}
                  provider={readable.ok ? (readable.metadata.model?.provider ?? "") : ""}
                  ready={setup.ready}
                  onConfigure={configure}
                  onCheckAgain={setup.recheck}
                  onRun={runAgent}
                />
              )}
              {overPanel === "model" && (
                <ModelPanel
                  content={content}
                  savedSecrets={session.state.savedSecrets}
                  issue={setup.issueOf(MODEL_ROW)}
                  onApply={(next) => {
                    setContent(next);
                    setup.changed(MODEL_ROW);
                  }}
                  onSaveKey={session.storeSecret}
                  onBack={backToSetup ? leavePanel : undefined}
                  onClose={leavePanel}
                />
              )}
              {overPanel === "tools" && readable.ok && (
                <ServerPanel
                  key={serverEditing ?? "new"}
                  content={content}
                  editing={serverEditing}
                  metadata={readable.metadata}
                  onApply={(next) => {
                    setContent(next);
                    if (serverEditing !== null) setup.changed(serverRowId(serverEditing));
                  }}
                  onServerDropped={revokeGrants}
                  onStoreSecret={session.storeSecret}
                  knownSecrets={session.state.savedSecrets}
                  issue={serverEditing === null ? null : setup.issueOf(serverRowId(serverEditing))}
                  onProbe={session.probeServer}
                  onSignIn={session.startOAuthSignIn}
                  onSignOut={session.signOutOAuth}
                  onBack={backToSetup ? leavePanel : undefined}
                  onClose={leavePanel}
                />
              )}
            </SidePane>
          )}
        </aside>
      </div>
    </div>
  );
}
