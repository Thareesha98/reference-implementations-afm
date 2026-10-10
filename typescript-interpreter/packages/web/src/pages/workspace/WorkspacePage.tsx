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

import { usableSecrets } from "../../chat-state";
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
import { NOTHING_OPEN, SIDE_TITLE, closePanel, openOver, openPanel, togglePanel } from "./workspace-view";
import type { SideState, SidePanel } from "./workspace-view";
import { resolveContent } from "../../load-paths";
import { EMPTY_TEMPLATE, initialContent, identityFor } from "./workspace-content";
import { useAgentsLibrary } from "../../agents/AgentsLibraryContext";
import { useHistory } from "../../history/HistoryContext";
import { permissionScopeFor, classifyToolRisk, grantsToRevoke } from "../../permissions-store";
import { permissionKey } from "../../protocol";
import { usePermissionsLedger } from "../../permissions/PermissionsLedgerContext";
import { agentBrief, getSection } from "./agent-source-edit";
import { useSettled } from "./use-settled";
import { useThemeContext } from "../../app/ThemeContext";
import { TurnNotificationWatcher } from "../../app/NotificationsContext";

export function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const draftSource = (location.state as { draftSource?: string } | null)?.draftSource;
  const [content, setContent] = useState(() => initialContent(searchParams, location.hash, draftSource));
  // What is on disk for this agent; anything else is unsaved.
  const [savedContent, setSavedContent] = useState(() => initialContent(searchParams, location.hash, draftSource));
  const [agentId, setAgentId] = useState<string | null>(() => searchParams.get("agentId"));
  const [saveFailed, setSaveFailed] = useState(false);
  const [fileLoading, setFileLoading] = useState(() => searchParams.get("file") !== null);
  const [fileError, setFileError] = useState<string | null>(null);
  // What is docked beside the builder, if anything. Closed by default.
  const [nav, setNav] = useState<SideState>(() => {
    if (searchParams.get("view") === "chat") return { open: "chat", under: [] };
    // A truly blank agent opens Start.
    return identityFor(searchParams, location.hash, draftSource) === "blank" ? { open: "start", under: [] } : NOTHING_OPEN;
  });
  const side = nav.open;
  const backToSetup = nav.under[nav.under.length - 1] === "setup";
  const [chatFull, setChatFull] = useState(() => searchParams.get("view") === "chat");
  // A run-only link is someone else's agent about to use your key, so it gets a trust screen first.
  const [trusted, setTrusted] = useState(() => searchParams.get("view") !== "chat");
  const [serverEditing, setServerEditing] = useState<string | null>(null);
  // Bumped to ask the stage for the raw file, when the problem is in the file.
  const [rawRequest, setRawRequest] = useState(0);
  const permissions = usePermissionsLedger();
  const theme = useThemeContext();
  // Mirrors of state the session's callbacks read after this render, so they never go stale.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const contentRef = useRef(content);
  contentRef.current = content;
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const testSession = useStandaloneSession({
    agentId: () => agentIdRef.current,
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
        classifyToolRisk(request.name, undefined),
        request.serverId,
      ),
  });
  const activity = useAgentActivity(testSession.state);
  const library = useAgentsLibrary();
  const history = useHistory();
  const preview = previewAgent(content);
  const loadedIdentityRef = useRef(identityFor(searchParams, location.hash, draftSource));
  // Read from the settings block alone, so a half-typed Role does not rename the agent, empty its
  // tools out of the diagram or stop it being saved. Running stays strict below.
  const readable = buildableAgent(content);
  const agentLabel = (readable.ok ? readable.metadata.name : undefined) ?? "Untitled agent";
  const agentIcon = readable.ok ? (readable.metadata.icon_url ?? "") : "";
  const settledContentForRead = useSettled(content);
  const setup = useSetup(testSession, readable.ok ? readable.metadata : null);
  const reached = reachOf(setup.rows);

  useEffect(() => {
    const nextIdentity = identityFor(searchParams, location.hash, draftSource);
    if (nextIdentity === loadedIdentityRef.current) return;
    loadedIdentityRef.current = nextIdentity;
    const next = initialContent(searchParams, location.hash, draftSource);
    const nextId = searchParams.get("agentId");
    setContent(next);
    setSavedContent(next);
    setAgentId(nextId);
    testSession.clearAgent();
  }, [searchParams, location.hash, draftSource]);

  // Put a recovered agentId back in the URL, merging so ?code=&state= survive, so a reload after
  // sign-in reopens this agent rather than saving another copy.
  useEffect(() => {
    if (agentId === null || searchParams.get("agentId") === agentId) return;
    loadedIdentityRef.current = agentId;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("agentId", agentId);
        return next;
      },
      { replace: true },
    );
    // Mount only: later id changes are already written by whoever made them.
  }, []);

  // An "Edit and Run" share carries ?file=<url>; fetch it once so the editor opens on the real
  // file, not the blank template.
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
    void resolveContent({ kind: "remote", url: fileParam }, fetch)
      .then((text) => {
        if (cancelled || text === null) return;
        setContent(text);
        setSavedContent(text);
        setAgentId(null);
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

  // The conversation belongs to the agent and is kept until it is deleted. Written on every settled
  // turn, since unload never fires reliably.
  const chatMessages = testSession.state.messages;
  const chatStatus = testSession.state.status;
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
      tokenCount: testSession.state.budget?.totalTokens ?? 0,
      startedAt: existing?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    // history is not a dependency: it changes identity on every write.
  }, [agentId, chatMessages, chatStatus]);

  // `source` defaults to the editor's text. A caller that just computed the next version passes it,
  // because setContent has not taken effect yet.
  function persistToLibrary(source: string = content): { id: string | null; persisted: boolean } {
    if (!readable.ok) return { id: null, persisted: false };
    const result = library.save({
      id: agentId ?? undefined,
      name: readable.metadata.name ?? "Untitled agent",
      description: readable.metadata.description ?? "",
      source,
      origin: "blank",
    });
    // Only a write that landed makes the file clean; otherwise autosave would believe unsaved work
    // is stored.
    if (result.persisted) setSavedContent(source);
    setSaveFailed(!result.persisted);
    if (agentId === null) {
      setAgentId(result.saved.id);
      loadedIdentityRef.current = result.saved.id;
      setSearchParams({ agentId: result.saved.id }, { replace: true });
    }
    return { id: result.saved.id, persisted: result.persisted };
  }

  // Run is available when the loaded agent differs from the editor: before the first run, after any
  // edit, and after a start that failed.
  const running = chatStatus !== "no-agent" && chatStatus !== "not-ready";
  const startedHere = chatStatus !== "no-agent" && testSession.state.agentSource === content;
  const failed = startedHere && chatStatus === "not-ready";
  const current = running && startedHere;
  const canRun = preview.ok && preview.plan.runnable && !current;

  const servers = readable.ok ? (readable.metadata.tools?.mcp ?? []) : [];
  const nameByUrl = serverNameByUrl(servers);
  const chatState = headerStatus(
    testSession.state.status,
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
    status: testSession.state.status,
    current,
    failed,
    brokenServerIds: activity.brokenServerIds,
    serverNameByUrl: nameByUrl,
  });

  // A server taken out of the file keeps its "always allow" answers on record, and would get them
  // back if the same server were added again.
  function revokeGrants(serverUrl: string) {
    const scope = permissionScopeFor(agentIdRef.current, contentRef.current);
    for (const entry of grantsToRevoke(permissions.forAgent(scope), serverUrl)) {
      permissions.set(scope, entry.toolName, "always-ask", entry.risk, serverUrl);
    }
  }

  function runAgent() {
    const { id } = persistToLibrary();
    // An agent keeps one conversation. Running it again resumes the thread; the agent is re-checked
    // either way, so a stale token or a vanished server is caught before the old messages return.
    const previous = id === null ? undefined : history.entries.find((entry) => entry.agentId === id);
    // Unless the brief was rewritten: the old replies were written by a different agent, and
    // handing them over makes the new Role read once and then ignored.
    const rewritten = running && agentBrief(testSession.state.agentSource) !== agentBrief(content);
    testSession.loadContent(content, previous?.messages, { carryConversation: !rewritten });
    openSide("chat");
  }

  function openSetup() {
    setup.start();
    openSide("setup");
  }

  function configure(row: SetupRow) {
    if (row.kind === "server") setServerEditing(row.name);
    show(openOver(nav, row.kind === "model" ? "model" : "tools"));
  }

  // Written once typing stops rather than on a button press. Nothing here is destructive (the
  // library keeps one row per agent), and a Save button only gave people a way to lose work.
  const settledContent = useSettled(content, 700);
  useEffect(() => {
    if (settledContent === savedContent) return;
    // A file whose settings cannot be read has no name to file it under; it stays in the editor
    // until it parses again.
    if (!buildableAgent(settledContent).ok) return;
    persistToLibrary(settledContent);
    // persistToLibrary is redefined every render; the content decides whether to write.
  }, [settledContent, savedContent]);

  function show(next: SideState) {
    setNav(next);
    if (next.open !== "chat") setChatFull(false);
  }

  const openSide = (next: SidePanel) => show(openPanel(nav, next));
  const toggleSide = (next: SidePanel) => show(togglePanel(nav, next));
  const leavePanel = () => show(closePanel(nav));
  const closeSide = () => show(NOTHING_OPEN);

  // What was on screen right before "New agent" or a template, generated or imported file replaced
  // it outright. Autosave catches most of it; this is the net under the last few keystrokes.
  const undoTimerRef = useRef<number | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<{ content: string; savedContent: string; agentId: string | null } | null>(
    null,
  );

  function parkUndo() {
    if (content.trim() === EMPTY_TEMPLATE.trim() && agentId === null) return;
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    setUndoSnapshot({ content, savedContent, agentId });
    undoTimerRef.current = window.setTimeout(() => setUndoSnapshot(null), 8000);
  }

  function undoDestructiveSwitch() {
    if (undoSnapshot === null) return;
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    const snapshot = undoSnapshot;
    setUndoSnapshot(null);
    setContent(snapshot.content);
    setSavedContent(snapshot.savedContent);
    setAgentId(snapshot.agentId);
    loadedIdentityRef.current = snapshot.agentId ?? "blank";
    setSearchParams(snapshot.agentId !== null ? { agentId: snapshot.agentId } : {}, { replace: true });
  }

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  const overPanel = side !== null && side !== "chat" ? side : null;
  const showTrust = !trusted && !fileLoading;
  const reachedServerIds = [
    ...new Set(
      testSession.state.tools.map((tool) => tool.serverId).filter((id): id is string => id !== undefined),
    ),
  ];

  return (
    <div className="workspace-shell">
      <TurnNotificationWatcher state={testSession.state} />
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
        onToggleTheme={theme.toggle}
        dark={theme.resolved === "dark"}
      />

      {fileLoading && <div className="draft-banner">Loading the agent file…</div>}
      {fileError !== null && (
        <div className="draft-banner draft-banner-error">
          <span>Couldn't load that file: {fileError}</span>
        </div>
      )}

      {}
      <div
        className={`u-body ${side !== null ? "has-side" : ""} ${chatFull ? "is-chat-full" : ""} ${
          showTrust ? "is-trust" : ""
        }`}
      >
        {showTrust && readable.ok && (
          <TrustScreen
            metadata={readable.metadata}
            source={content}
            savedSecrets={usableSecrets(testSession.state)}
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

        {}
        <div className="u-float-scrim" onClick={leavePanel} role="presentation" />

        {/* Mounted whether or not open: unmounting the conversation would lose its scroll position and the half-typed message. */}
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
              session={testSession}
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
              {overPanel === "agents" && (
                <AgentPicker
                  currentId={agentId}
                  onPick={(saved) => {
                    closeSide();
                    setSearchParams({ agentId: saved.id }, { replace: true });
                  }}
                  onNew={() => {
                    parkUndo();
                    closeSide();
                    setSearchParams({}, { replace: true });
                    setContent(EMPTY_TEMPLATE);
                    setSavedContent(EMPTY_TEMPLATE);
                    setAgentId(null);
                    loadedIdentityRef.current = "blank";
                    testSession.clearAgent();
                    openSide("start");
                  }}
                />
              )}
              {overPanel === "start" && (
                <StartHere
                  compact
                  state={testSession.state}
                  onUseSource={(source) => {
                    parkUndo();
                    setContent(source);
                    setSavedContent(source);
                    setAgentId(null);
                    setSearchParams({}, { replace: true });
                    loadedIdentityRef.current = "blank";
                    testSession.clearAgent();
                    closeSide();
                  }}
                  onBlank={closeSide}
                  onGenerate={(prompt, model, final) => testSession.generateDraft(prompt, model, final)}
                  onSaveKey={testSession.storeSecret}
                  onOpenKeys={testSession.openKeys}
                  onDismissDraft={testSession.dismissDraft}
                />
              )}
              {overPanel === "share" && <SharePanel agentSource={content} />}
              {overPanel === "settings" && (
                <SettingsPanel session={testSession} />
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
                  keys={setup.keys}
                  provider={readable.ok ? (readable.metadata.model?.provider ?? "") : ""}
                  ready={setup.ready}
                  onConfigure={configure}
                  onCheckAgain={setup.recheck}
                  onRetryKeys={setup.retryKeys}
                  onRun={runAgent}
                />
              )}
              {overPanel === "model" && (
                <ModelPanel
                  content={content}
                  savedSecrets={usableSecrets(testSession.state)}
                  passkeySecrets={testSession.state.passkeySecrets}
                  issue={setup.issueOf(MODEL_ROW)}
                  onApply={(next) => {
                    setContent(next);
                    setup.changed(MODEL_ROW);
                  }}
                  onSaveKey={testSession.storeSecret}
                  onBack={backToSetup ? leavePanel : undefined}
                  onClose={leavePanel}
                />
              )}
              {overPanel === "tools" && readable.ok && (
                <ServerPanel
                  // A fresh instance per server: the key re-runs field initialisers that would
                  // otherwise keep showing the first server clicked.
                  key={serverEditing ?? "new"}
                  content={content}
                  editing={serverEditing}
                  metadata={readable.metadata}
                  onApply={(next) => {
                    setContent(next);
                    if (serverEditing !== null) setup.changed(serverRowId(serverEditing));
                  }}
                  onServerDropped={revokeGrants}
                  onStoreSecret={testSession.storeSecret}
                  knownSecrets={usableSecrets(testSession.state)}
                  issue={serverEditing === null ? null : setup.issueOf(serverRowId(serverEditing))}
                  onProbe={testSession.probeServer}
                  onSignIn={testSession.startOAuthSignIn}
                  onSignOut={testSession.signOutOAuth}
                  onBack={backToSetup ? leavePanel : undefined}
                  onClose={leavePanel}
                />
              )}
            </SidePane>
          )}
        </aside>
      </div>

      {undoSnapshot !== null && (
        <div className="u-undo-toast" role="status">
          <span>Replaced what was in the editor.</span>
          <button className="u-linkish" onClick={undoDestructiveSwitch}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
