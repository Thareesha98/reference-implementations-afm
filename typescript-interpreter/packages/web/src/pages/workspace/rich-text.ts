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

/**
 * Markdown in the file, formatted text on the screen. The agent reads the characters, so `**bold**`
 * must stay `**bold**` on disk; these two functions carry the same content between the forms, one
 * to fill the editable box and one to read it back after every keystroke.
 *
 * The set they carry is deliberately small. Anything outside it stays plain text rather than
 * guessed at, since inventing structure changes what the agent was told.
 */

/**
 * The part of a DOM node this file needs; a plain object satisfies it, so the reading direction is
 * testable without a browser.
 */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
}

const ELEMENT = 1;
const TEXT = 3;

const INLINE_MARK: Record<string, string> = {
  STRONG: "**",
  B: "**",
  EM: "*",
  I: "*",
  S: "~~",
  STRIKE: "~~",
  DEL: "~~",
  CODE: "`",
};

const HEADING_HASHES: Record<string, string> = { H1: "#", H2: "##", H3: "###", H4: "####" };

function children(node: NodeLike): NodeLike[] {
  return Array.from({ length: node.childNodes.length }, (_, i) => node.childNodes[i] as NodeLike);
}

/** Inline markers made literal so a stray asterisk survives the round trip. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function rawText(node: NodeLike): string {
  if (node.nodeType === TEXT) return node.textContent ?? "";
  return children(node).map(rawText).join("");
}

function inlineOf(node: NodeLike): string {
  if (node.nodeType === TEXT) return escapeInline(node.textContent ?? "");
  if (node.nodeType !== ELEMENT) return "";
  if (node.nodeName === "BR") return "\n";
  // Markdown does not read markers inside a code span, so escaping there would put backslashes in
  // the file.
  if (node.nodeName === "CODE") {
    const code = rawText(node);
    return code.trim() === "" ? code : `\`${code}\``;
  }

  const inner = children(node).map(inlineOf).join("");
  if (node.nodeName === "A") {
    const href = node.getAttribute?.("href") ?? "";
    return href === "" ? inner : `[${inner}](${href})`;
  }
  const mark = INLINE_MARK[node.nodeName];
  if (mark !== undefined) return inner.trim() === "" ? inner : `${mark}${inner}${mark}`;
  return inner;
}

function listItems(node: NodeLike, ordered: boolean): string[] {
  let n = 0;
  return children(node)
    .filter((child) => child.nodeName === "LI")
    .map((item) => {
      n += 1;
      const text = children(item).map(inlineOf).join("").trim();
      return ordered ? `${n}. ${text}` : `- ${text}`;
    });
}

function blockOf(node: NodeLike): string[] {
  if (node.nodeType === TEXT) {
    const text = escapeInline(node.textContent ?? "").trim();
    return text === "" ? [] : [text];
  }
  if (node.nodeType !== ELEMENT) return [];

  const name = node.nodeName;
  if (name === "UL" || name === "OL") {
    const items = listItems(node, name === "OL");
    return items.length === 0 ? [] : [items.join("\n")];
  }
  if (name === "BLOCKQUOTE") {
    const text = children(node)
      .flatMap(blockOf)
      .join("\n\n")
      .split("\n")
      .map((line) => (line === "" ? ">" : `> ${line}`))
      .join("\n");
    return text.trim() === ">" || text === "" ? [] : [text];
  }
  const hashes = HEADING_HASHES[name];
  if (hashes !== undefined) {
    const text = children(node).map(inlineOf).join("").trim();
    return text === "" ? [] : [`${hashes} ${text}`];
  }
  if (name === "P" || name === "DIV") {
    const text = children(node).map(inlineOf).join("").replace(/[ \t]+$/gm, "");
    return text.trim() === "" ? [] : [text];
  }
  // An inline element at block level, which is what a browser leaves when a line has no wrapper.
  const inline = inlineOf(node);
  return inline.trim() === "" ? [] : [inline];
}

export function toMarkdown(root: NodeLike): string {
  return children(root).flatMap(blockOf).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Agent files are shared, so their text is never trusted as markup: everything is escaped before
 * any tag of ours touches it.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

// The one place an attribute is written. A scheme this runtime never meant to produce (javascript:,
// data:, vbscript:) must not reach an href, so a link is only built for a scheme on this list. No
// scheme (a relative path, an anchor) is left alone.
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);

function hrefIsSafe(href: string): boolean {
  // Browsers skip control characters and spaces before a scheme, so they are skipped here too.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href.replace(/[\u0000-\u0020\u007f]/g, ""))?.[1];
  return scheme === undefined || LINK_SCHEMES.has(scheme.toLowerCase());
}

function inlineHtml(text: string): string {
  // Escaped markers are put aside first so `\*` stays a literal asterisk instead of opening
  // emphasis.
  const held: string[] = [];
  const withHolds = text.replace(/\\([\\`*_[\]])/g, (_, char: string) => {
    held.push(char);
    return `\u0000${held.length - 1}\u0000`;
  });

  const html = escapeHtml(withHolds)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, label: string, href: string) =>
      hrefIsSafe(href) ? `<a href="${href}">${label}</a>` : label,
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => escapeHtml(held[Number(index)] ?? ""));
}

export function toHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let para: string[] = [];

  const flush = () => {
    if (list !== null) {
      const items = list.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("");
      out.push(list.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      list = null;
    }
    if (quote.length > 0) {
      out.push(`<blockquote>${quote.map((line) => `<p>${inlineHtml(line)}</p>`).join("")}</blockquote>`);
      quote = [];
    }
    if (para.length > 0) {
      // Run-on lines stay one paragraph joined by breaks; a paragraph per line would come back
      // doubled.
      out.push(`<p>${para.map(inlineHtml).join("<br>")}</p>`);
      para = [];
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    const quoted = /^>\s?(.*)$/.exec(line);

    if (heading !== null) {
      flush();
      out.push(`<h${heading[1]!.length}>${inlineHtml(heading[2]!)}</h${heading[1]!.length}>`);
    } else if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      if (list === null || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet?.[1] ?? numbered?.[1]) as string);
    } else if (quoted !== null) {
      if (list !== null || para.length > 0) flush();
      quote.push(quoted[1] ?? "");
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list !== null || quote.length > 0) flush();
      para.push(line);
    }
  }
  flush();
  // Never empty: a contenteditable with no block puts the caret nowhere.
  return out.length === 0 ? "<p><br></p>" : out.join("");
}
