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
  rewindOnBlur?: boolean;
  ariaLabel: string;
}

export function RichText({ value, placeholder, className = "", onChange, docKey = "", rewindOnBlur = false, ariaLabel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

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
