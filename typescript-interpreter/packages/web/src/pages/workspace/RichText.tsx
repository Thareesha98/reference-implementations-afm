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

import { useEffect, useRef } from "react";
import { toHtml, toMarkdown } from "./rich-text";

interface Props {
  value: string;
  placeholder: string;
  className?: string;
  onChange: (markdown: string) => void;
  docKey?: string;
  /**
   * Back to the top when the caret leaves. True on the diagram, where the field is a summary; false
   * in the writing window, where being scrolled away would lose your place.
   */
  rewindOnBlur?: boolean;
  ariaLabel: string;
}

/**
 * Formatted text on screen, Markdown in the file.
 *
 * The box is deliberately not controlled by React: re-rendering on every keystroke would reset the
 * caret, so the text is seeded once and the box owns it from then on. `value` is read back after
 * every edit and handed up as Markdown; `docKey` is the only thing that re-seeds.
 *
 * `execCommand` is deprecated with no replacement, but every browser implements it and a
 * selection-and-range editor of our own is a far larger surface to get wrong.
 */
export function RichText({ value, placeholder, className = "", onChange, docKey = "", rewindOnBlur = false, ariaLabel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // What we last handed up; a match came from us, so re-seeding would only reset the caret.
  const lastEmitted = useRef<string | null>(null);

  /**
   * Whether there is text below the fold. The fade is drawn only while something is hidden; a
   * permanent one would dim the last line of every short field.
   */
  function markOverflow() {
    const node = box.current;
    if (node === null) return;
    const more = node.scrollHeight - node.scrollTop - node.clientHeight > 1;
    node.classList.toggle("has-more", more);
  }

  useEffect(() => {
    const node = box.current;
    if (node === null) return;
    if (value === lastEmitted.current) return;
    node.innerHTML = toHtml(value);
    lastEmitted.current = value;
    markOverflow();
  }, [value, docKey]);

  function read() {
    const node = box.current;
    if (node === null) return;
    const markdown = toMarkdown(node);
    // Only when it differs: opening and closing a field must leave the file alone.
    if (markdown === lastEmitted.current) return;
    lastEmitted.current = markdown;
    onChange(markdown);
  }

  return (
    <div
      ref={box}
      className={`rich-text ${className}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      onInput={() => {
        read();
        markOverflow();
      }}
      onScroll={markOverflow}
      onBlur={() => {
        read();
        if (rewindOnBlur && box.current !== null) box.current.scrollTop = 0;
        markOverflow();
      }}
      onKeyDown={(event) => {
        if (mergeIntoPreviousItem(event)) read();
      }}
      onPaste={(event) => {
        // Plain text only: pasted markup would put a page's styling into the agent's instructions.
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

export type Command =
  | { kind: "inline"; command: string }
  | { kind: "block"; tag: string }
  | { kind: "list"; command: string }
  | { kind: "code" }
  | { kind: "link" }
  | { kind: "clear" };

export function applyCommand(command: Command, href?: string): void {
  switch (command.kind) {
    case "inline":
      document.execCommand(command.command);
      return;
    case "block": {
      // Pressing a heading twice gives the paragraph back rather than nesting.
      const current = document.queryCommandValue("formatBlock").toLowerCase();
      document.execCommand("formatBlock", false, current === command.tag ? "p" : command.tag);
      return;
    }
    case "list":
      document.execCommand(command.command);
      return;
    case "code": {
      const selected = window.getSelection()?.toString() ?? "";
      if (selected === "") return;
      document.execCommand("insertHTML", false, `<code>${escapeForInsert(selected)}</code>`);
      return;
    }
    case "link":
      if (href === undefined || href.trim() === "") return;
      document.execCommand("createLink", false, href.trim());
      return;
    case "clear":
      document.execCommand("removeFormat");
      document.execCommand("unlink");
      return;
  }
}

function escapeForInsert(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Backspace at the start of a list item joins it onto the one above, keeping its text. Left alone
 * the browser turns the item into a paragraph and drops it out of the list.
 */
function mergeIntoPreviousItem(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (event.key !== "Backspace") return false;
  const selection = window.getSelection();
  if (selection === null || !selection.isCollapsed || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const item = closestListItem(range.startContainer);
  if (item === null || !atStartOf(item, range)) return false;

  const previous = item.previousElementSibling;
  if (previous === null || previous.tagName !== "LI") return false;

  event.preventDefault();
  const joinAt = previous.childNodes.length;
  while (item.firstChild !== null) previous.appendChild(item.firstChild);
  item.remove();

  // The caret goes where the two halves meet, so typing carries on mid-sentence.
  const merged = document.createRange();
  merged.setStart(previous, joinAt);
  merged.collapse(true);
  selection.removeAllRanges();
  selection.addRange(merged);
  return true;
}

function closestListItem(node: Node): HTMLElement | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return start?.closest("li") ?? null;
}

function atStartOf(item: HTMLElement, range: Range): boolean {
  const before = range.cloneRange();
  before.selectNodeContents(item);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString() === "";
}
