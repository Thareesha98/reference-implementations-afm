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
import type { ReactNode } from "react";
import { EXAMPLES } from "../../examples";
import { MODEL_PROVIDERS, findProvider } from "./model-catalog";
import type { AgentModelRef } from "../../protocol";
import type { ChatState } from "../../chat-state";
import { resolveContent, normalizeAgentFileUrl } from "../../load-paths";
import { usableSecrets } from "../../chat-state";
import { KeepOnDevice } from "./KeepOnDevice";

function SetupColumn({ children }: { children: ReactNode }) {
  return (
    <div className="u-setup">
      <div className="u-setup-col">{children}</div>
    </div>
  );
}

const ICON_PATHS = {
  blank: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6",
  generate: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  template: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  file: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  back: "M19 12H5M12 19l-7-7 7-7",
  warn: "M12 9v5M12 17.4h.01M10.3 3.9L2.4 17.4A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3.1L13.7 3.9a2 2 0 00-3.4 0z",
};

function Glyph({ path, size = 15 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function StartOption({ icon, name, desc, onClick, on = false }: { icon: ReactNode; name: string; desc: string; onClick: () => void; on?: boolean }) {
  return (
    <button className={on ? "u-start-opt on" : "u-start-opt"} onClick={onClick}>
      <span className="u-start-ico" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="u-start-name">{name}</span>
        <span className="u-start-desc">{desc}</span>
      </span>
    </button>
  );
}

type View = "menu" | "templates" | "prompt" | "import";

interface Props {
  state: ChatState;
  /** Fills the editor; the user then presses Run, so nothing starts behind their back. */
  onUseSource: (source: string) => void;
  onGenerate: (prompt: string, model: AgentModelRef, final?: boolean) => void;
  onDismissDraft: () => void;
  /** Saves a key typed here, so writing a file does not detour through a key prompt. */
  onSaveKey: (name: string, value: string, keep: boolean) => Promise<boolean>;
  /** Opens the keys saved on this device. Must run inside the click. */
  onOpenKeys: () => Promise<boolean>;
  /** True in the side drawer, where "press Run" would point off-screen. */
  compact?: boolean;
  onBlank?: () => void;
}

// The chat pane before an agent has run: says what to press and offers three other ways in.
export function StartHere({
  state,
  onUseSource,
  onGenerate,
  onSaveKey,
  onDismissDraft,
  onOpenKeys,
  compact = false,
  onBlank = () => {},
}: Props) {
  const [view, setView] = useState<View>("menu");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(MODEL_PROVIDERS[0]!.id);
  const [modelId, setModelId] = useState(MODEL_PROVIDERS[0]!.models[0]!.id);
  const [key, setKey] = useState("");
  const [keep, setKeep] = useState(false);
  const [answers, setAnswers] = useState("");
  const [link, setLink] = useState("");
  const [dropping, setDropping] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  // True only while a request is out, not derived from the prompt text.
  const [writing, setWriting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const provider = findProvider(providerId) ?? MODEL_PROVIDERS[0]!;
  const keySaved = usableSecrets(state).includes(provider.secretName);
  const keyClosed = keySaved && !state.savedSecrets.includes(provider.secretName);

  // The worker answered (file, questions or error), so the write is over. Only an arriving answer
  // counts: a new request clears the last one first, which must not read as an answer.
  const answered =
    state.generatedDraft !== null || state.clarifyQuestions.length > 0 || state.draftError !== null;
  useEffect(() => {
    if (answered) setWriting(false);
  }, [answered]);

  const authoringModel = {
    provider: provider.id,
    name: modelId,
    authentication: { type: "api-key", api_key: `\${env:${provider.secretName}}` },
  } as AgentModelRef;

  async function writeFile(final = false, request = prompt.trim()) {
    if (request === "") return;
    setWriting(true);
    if (keyClosed) await onOpenKeys();
    else if (!keySaved && key.trim() !== "") void onSaveKey(provider.secretName, key.trim(), keep);
    onGenerate(request, authoringModel, final);
  }

  async function openFile(file: File | undefined) {
    if (file === undefined) return;
    onUseSource(await file.text());
  }

  async function openLink() {
    const normalized = normalizeAgentFileUrl(link.trim());
    if (!normalized.ok) {
      setImportError(normalized.error);
      return;
    }
    setFetching(true);
    setImportError(null);
    try {
      const text = await resolveContent({ kind: "remote", url: normalized.url }, fetch);
      if (text === null) {
        setImportError("Nothing came back from that address.");
        return;
      }
      onUseSource(text);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(false);
    }
  }

  if (view === "import") {
    return (
      <SetupColumn>
        <BackLink onClick={() => setView("menu")} />
        <h3 className="u-setup-title">Import a file</h3>
        <div
          className={`u-drop ${dropping ? "on" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            void openFile(event.dataTransfer.files[0]);
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
          }}
        >
          <span className="u-drop-ico" aria-hidden="true">
            <Glyph path={ICON_PATHS.file} size={17} />
          </span>
          Drop an <code>.afm.md</code> here, or choose one
        </div>

        <div className="u-divider" />
        <label className="u-group">
          <span className="u-label">Or paste a link to one</span>
          <div className="u-input-row">
            <input
              className="u-input"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://…/agent.afm.md"
              onKeyDown={(event) => {
                if (event.key === "Enter") void openLink();
              }}
            />
            <button className="u-btn ghost" disabled={link.trim() === "" || fetching} onClick={() => void openLink()}>
              {fetching ? "Opening…" : "Open"}
            </button>
          </div>
        </label>
        {importError !== null && <p className="u-errcard">{importError}</p>}

        <input
          ref={fileInput}
          type="file"
          accept=".md,.afm.md,text/markdown,text/plain"
          className="visually-hidden"
          onChange={(event) => void openFile(event.target.files?.[0])}
        />
      </SetupColumn>
    );
  }

  if (view === "templates") {
    return (
      <SetupColumn>
        <BackLink onClick={() => setView("menu")} />
        <h3 className="u-setup-title">Pick a starting point</h3>
        <div className="u-start-list">
          {EXAMPLES.map((example) => (
            <StartOption
              key={example.title}
              icon={example.icon}
              name={example.title}
              desc={example.description}
              onClick={() => onUseSource(example.content)}
            />
          ))}
        </div>
      </SetupColumn>
    );
  }

  // Checked before the draft and questions below: while a request is out they hold their last
  // value, so the screen would otherwise fall through to the describe-it form.
  if (writing) {
    return (
      <SetupColumn>
        <h3 className="u-setup-title">Writing the file</h3>
        <p className="u-generating">
          <span className="u-spinner" aria-hidden="true" />
          Generating…
        </p>
      </SetupColumn>
    );
  }

  // A written file is shown before it is used, not filled into the editor silently.
  if (state.generatedDraft !== null) {
    const draft = state.generatedDraft;
    return (
      <SetupColumn>
        <h3 className="u-setup-title">Here is the file it wrote</h3>
        <p className="u-setup-note">
          Nothing has been changed yet. Using it puts this in the editor, where you can read it and
          edit it before pressing Run.
        </p>
        <pre className="u-draft">{draft}</pre>
        <div className="u-panel-foot">
          <button
            className="u-btn ghost"
            onClick={() => {
              onDismissDraft();
              setView("prompt");
            }}
          >
            Write it again
          </button>
          <button className="u-btn primary" onClick={() => onUseSource(draft)}>
            Use this file
          </button>
        </div>
      </SetupColumn>
    );
  }

  // The model wants more before writing. Answering and asking again with `final` set forces a file.
  if (state.clarifyQuestions.length > 0) {
    return (
      <SetupColumn>
        <h3 className="u-setup-title">A couple of questions first</h3>
        <ul className="u-rows">
          {state.clarifyQuestions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
        <form
          className="u-group"
          onSubmit={(event) => {
            event.preventDefault();
            if (answers.trim() === "") return;
            void writeFile(true, `${prompt.trim()}\n\nAnswers to your questions:\n${answers.trim()}`);
            setAnswers("");
          }}
        >
          <textarea
            className="u-area"
            value={answers}
            onChange={(event) => setAnswers(event.target.value)}
            placeholder="Answer in your own words…"
            rows={4}
            autoFocus
          />
          <div className="u-panel-foot">
            <button
              className="u-btn ghost"
              type="button"
              disabled={writing}
              onClick={() => {
                void writeFile(true, prompt.trim());
                setAnswers("");
              }}
            >
              Skip
            </button>
            <button className="u-btn primary" type="submit" disabled={answers.trim() === "" || writing}>
              {writing ? "Writing the file…" : "Write the agent file"}
            </button>
          </div>
        </form>
      </SetupColumn>
    );
  }

  if (view === "prompt") {
    const canWrite = prompt.trim() !== "" && (keySaved || key.trim() !== "") && !writing;
    return (
      <SetupColumn>
        <BackLink onClick={() => setView("menu")} />
        <h3 className="u-setup-title">Describe the agent you want</h3>
        <p className="u-setup-note">
          Say what it should do and how it should behave. The file appears in the editor for you to read
          before anything runs.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void writeFile();
          }}
          className="u-group"
        >
          <textarea
            className="u-area"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="A support agent for a coffee roastery that answers questions about beans and delivery…"
            rows={5}
            autoFocus
          />

          {/* Writing the file is a model call paid for by the user's own key. */}
          <div className="u-label">Written by your own model</div>
          <div className="u-input-row">
            <label className="u-group u-input-col">
              <span className="u-label">Provider</span>
              <select
                className="u-input"
                value={providerId}
                onChange={(event) => {
                  const next = findProvider(event.target.value) ?? MODEL_PROVIDERS[0]!;
                  setProviderId(next.id);
                  setModelId(next.models[0]!.id);
                }}
              >
                {MODEL_PROVIDERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="u-group u-input-col">
              <span className="u-label">Model</span>
              <select className="u-input" value={modelId} onChange={(event) => setModelId(event.target.value)}>
                {provider.models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!keySaved && (
            <>
              <label className="u-group">
                <span className="u-label">{provider.secretName}</span>
                <input
                  className="u-input"
                  type="password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={provider.secretName}
                  autoComplete="off"
                />
              </label>
              <KeepOnDevice keep={keep} onChange={setKeep} />
            </>
          )}

          <p className="u-usage-note">
            <Glyph path={ICON_PATHS.warn} size={15} />
            <span>
              Your <strong>{provider.label}</strong> API usage will be used to write this file.
            </span>
          </p>

          <button className="u-btn primary wide" type="submit" disabled={!canWrite}>
            {writing ? "Writing the file…" : "Write the agent file"}
          </button>
        </form>
        {state.draftError !== null && <p className="u-errcard">{state.draftError}</p>}
      </SetupColumn>
    );
  }

  return (
    <SetupColumn>
      {compact ? (
        <p className="u-setup-note">
          The empty agent is already beside you. Fill it in yourself, or start from one of these.
          <br />
          Nothing is installed. Everything stays in this tab.
        </p>
      ) : (
        <>
          <h3 className="u-setup-title">An agent is a file. This one is ready.</h3>
          <p className="u-setup-note">
            Edit the fields on the left and press <strong>Run</strong> to start talking to it.
            <br />
            Nothing is installed. Everything stays in this tab.
          </p>

          <div className="u-divider" />
          <div className="u-label">Or start from something else</div>
        </>
      )}

      <div className="u-start-list">
        {/* First: it is what the stage already shows. */}
        <StartOption icon={<Glyph path={ICON_PATHS.blank} />} name="Blank" onClick={onBlank} on
          desc="Write the role and instructions yourself. It is already on the left." />
        <StartOption icon={<Glyph path={ICON_PATHS.generate} />} name="Generate with AI" onClick={() => setView("prompt")}
          desc="Describe what you want and get a first version to edit." />
        <StartOption icon={<Glyph path={ICON_PATHS.template} />} name="From a template" onClick={() => setView("templates")}
          desc="Agents that already do something useful." />
        <StartOption icon={<Glyph path={ICON_PATHS.file} />} name="Import a file" onClick={() => setView("import")}
          desc="Open an .afm.md you were sent, or paste a link to one." />
      </div>
    </SetupColumn>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="u-back" onClick={onClick}>
      <Glyph path={ICON_PATHS.back} size={14} />
      Back
    </button>
  );
}
