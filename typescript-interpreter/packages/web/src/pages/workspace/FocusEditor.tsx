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
import { RichText, applyCommand } from "./RichText";
import { WriteModeSwitch } from "./ViewControls";
import type { WriteMode } from "./ViewControls";
import { tidyIntoBullets, canTidy } from "./tidy-text";
import type { Command } from "./RichText";

interface Props {
  title: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

interface Tool {
  key: string;
  label: string;
  command: Command;
  icon: ReactNode;
}

const TOOLS: Tool[][] = [
  [
    { key: "bold", label: "Bold", command: { kind: "inline", command: "bold" },
      icon: <path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z" /> },
    { key: "italic", label: "Italic", command: { kind: "inline", command: "italic" },
      icon: <path d="M15 5h-5M14 19H9M14 5l-4 14" /> },
    { key: "strike", label: "Strikethrough", command: { kind: "inline", command: "strikeThrough" },
      icon: <path d="M5 12h14M16 7a4 4 0 00-8 .5c0 1.5 1 2.3 3 3M8.5 17a4 4 0 007-2" /> },
    { key: "code", label: "Code", command: { kind: "code" },
      icon: <path d="M9 18l-6-6 6-6M15 6l6 6-6 6" /> },
  ],
  [
    { key: "h2", label: "Heading", command: { kind: "block", tag: "h2" },
      icon: <path d="M6 5v14M16 5v14M6 12h10" /> },
    { key: "h3", label: "Small heading", command: { kind: "block", tag: "h3" },
      icon: <path d="M5 6v12M14 6v12M5 12h9M19 9v6" /> },
    { key: "quote", label: "Quote", command: { kind: "block", tag: "blockquote" },
      icon: <path d="M7 7h4v6H7zM13 7h4v6h-4M9 13v4M15 13v4" /> },
  ],
  [
    { key: "bullet", label: "Bulleted list", command: { kind: "list", command: "insertUnorderedList" },
      icon: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /> },
    { key: "number", label: "Numbered list", command: { kind: "list", command: "insertOrderedList" },
      icon: <path d="M10 6h10M10 12h10M10 18h10M4 6h2M4 12h2l-2 3h2M4 18h2v3H4" /> },
  ],
  [
    { key: "clear", label: "Plain text", command: { kind: "clear" },
      icon: <path d="M4 7h16M7 7l1.5 12h7L17 7M10 11v4M14 11v4" /> },
  ],
];

/**
 * A whole window for one field. Writing the Role and the Instructions is most of the work; the
 * screen shows formatted text while the file keeps the Markdown the agent reads.
 */
export function FocusEditor({ title, hint, value, placeholder, onChange, onClose }: Props) {
  const [mode, setMode] = useState<WriteMode>("rich");
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("");
  // Where the cursor was before the link box took focus, so the link lands on the chosen words.
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function startLink() {
    const selection = window.getSelection();
    savedRange.current = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    setHref("");
    setLinking(true);
  }

  function finishLink() {
    const range = savedRange.current;
    if (range !== null) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    applyCommand({ kind: "link" }, href);
    setLinking(false);
  }

  return (
    <div className="u-focus" onMouseDown={onClose} role="presentation">
      <div
        className="u-focus-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="u-focus-head">
          <span className="u-focus-title">{title}</span>
          <span className="u-focus-hint">{hint}</span>
          <WriteModeSwitch mode={mode} onMode={setMode} />
          <button className="u-ico" onClick={onClose} aria-label="Done" title="Done">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 9L4 4M9 9V4M9 9H4M15 9l5-5M15 9V4M15 9h5M9 15l-5 5M9 15v5M9 15H4M15 15l5 5M15 15v5M15 15h5" />
            </svg>
          </button>
        </div>

        {mode === "rich" && (
        <div className="u-tools" role="toolbar" aria-label="Formatting">
          {TOOLS.map((group, index) => (
            <div className="u-tool-group" key={index}>
              {group.map((tool) => (
                <button
                  key={tool.key}
                  className="u-tbtn"
                  // Keep the selection in the box: the button never takes focus from it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyCommand(tool.command)}
                  title={tool.label}
                  aria-label={tool.label}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {tool.icon}
                  </svg>
                </button>
              ))}
            </div>
          ))}
          <div className="u-tool-group">
            <button
              className="u-tbtn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={startLink}
              title="Link"
              aria-label="Link"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12 19" />
              </svg>
            </button>
          </div>

          {}
          <span className="u-spacer" />
          <button
            className="u-btn ghost sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(tidyIntoBullets(value))}
            disabled={!canTidy(value)}
            title="Put each sentence on its own line. Your words are not changed."
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
            </svg>
            Tidy up
          </button>
        </div>
        )}

        {linking && (
          <form
            className="u-focus-link"
            onSubmit={(event) => {
              event.preventDefault();
              finishLink();
            }}
          >
            <input
              className="u-input"
              autoFocus
              value={href}
              placeholder="https://…"
              onChange={(event) => setHref(event.target.value)}
            />
            <button className="u-btn primary" type="submit" disabled={href.trim() === ""}>
              Link it
            </button>
            <button className="u-btn ghost" type="button" onClick={() => setLinking(false)}>
              Cancel
            </button>
          </form>
        )}

        <div className="u-focus-scroll">
          {mode === "rich" ? (
            <RichText
              value={value}
              placeholder={placeholder}
              className="u-focus-body"
              docKey={title}
              ariaLabel={title}
              onChange={onChange}
            />
          ) : (
            <textarea
              className="u-focus-body u-focus-raw"
              value={value}
              placeholder={placeholder}
              aria-label={`${title} as Markdown`}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
