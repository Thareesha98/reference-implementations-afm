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

import { useRef } from "react";
import type { UIEvent } from "react";
import { highlightAfm } from "./afm-highlight";
import type { Token } from "./afm-highlight";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /**
   * 1-indexed source lines with a validation error, drawn in the soft red `.u-errcard` already
   * uses.
   */
  errorLines?: ReadonlySet<number>;
}

/**
 * Splits the flat token stream into one array per source line on the "\n" tokens highlightAfm()
 * inserts, so a wrapped line still highlights as one block.
 */
function tokenLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "plain" && token.text === "\n") {
      lines.push([]);
      continue;
    }
    lines[lines.length - 1]!.push(token);
  }
  return lines;
}

// A real textarea with the highlighted copy painted behind it. The textarea's own text is
// transparent, so caret, selection, undo and IME stay native. The layers stay aligned only while
// they lay text out identically, which `.code-editor-face` in studio.css guarantees.
export function CodeEditor({ value, onChange, errorLines }: Props) {
  const viewRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const tokens = highlightAfm(value);
  const codeLines = tokenLines(tokens);

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    const view = viewRef.current;
    if (view === null) return;
    view.scrollTop = event.currentTarget.scrollTop;
    view.scrollLeft = event.currentTarget.scrollLeft;
    if (gutterRef.current !== null) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  }

  // The gutter scrolls with the text; numbers inside the textarea would be selectable and copied
  // with the file.
  const lineCount = value.split("\n").length;

  return (
    <div className="code-editor u-raw">
      <pre className="code-editor-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => `${index + 1}\n`).join("")}
      </pre>
      <pre className="code-editor-face code-editor-view" ref={viewRef} aria-hidden="true">
        {/* One block-level span per source line so a highlight stays placed when a line wraps. */}
        {codeLines.map((lineTokens, index) => (
          <span
            className={`code-editor-line ${errorLines?.has(index + 1) === true ? "is-error-line" : ""}`}
            key={index}
          >
            {lineTokens.map((token, tokenIndex) => (
              <span className={`syn-${token.kind}`} key={tokenIndex}>
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </pre>
      <textarea
        className="code-editor-face code-editor-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Agent file source"
      />
    </div>
  );
}
