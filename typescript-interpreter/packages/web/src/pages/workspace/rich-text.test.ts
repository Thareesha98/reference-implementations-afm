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

import { describe, it, expect } from "vitest";
import { toMarkdown, toHtml } from "./rich-text";
import type { NodeLike } from "./rich-text";

// Plain objects standing in for DOM nodes, so the reading direction is testable with no browser.
function text(value: string): NodeLike {
  return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] };
}
function el(nodeName: string, kids: NodeLike[] = [], attrs: Record<string, string> = {}): NodeLike {
  return {
    nodeType: 1,
    nodeName,
    textContent: null,
    childNodes: kids,
    getAttribute: (name) => attrs[name] ?? null,
  };
}
const root = (...kids: NodeLike[]) => el("DIV", kids);

describe("reading the editable box back as Markdown", () => {
  it("keeps a paragraph a paragraph", () => {
    expect(toMarkdown(root(el("P", [text("Answer clearly.")])))).toBe("Answer clearly.");
  });

  it("writes bold and italic as markers", () => {
    const p = el("P", [text("Answer "), el("STRONG", [text("clearly")]), text(" and "), el("EM", [text("briefly")])]);
    expect(toMarkdown(root(p))).toBe("Answer **clearly** and *briefly*");
  });

  // What a browser produces for the same intent varies; the file must not.
  it("treats B and I the same as STRONG and EM", () => {
    expect(toMarkdown(root(el("P", [el("B", [text("a")]), el("I", [text("b")])])))).toBe("**a***b*");
  });

  it("writes strikethrough and code", () => {
    const p = el("P", [el("S", [text("old")]), text(" "), el("CODE", [text("read_file")])]);
    expect(toMarkdown(root(p))).toBe("~~old~~ `read_file`");
  });

  it("writes links", () => {
    const p = el("P", [el("A", [text("the docs")], { href: "https://example.com" })]);
    expect(toMarkdown(root(p))).toBe("[the docs](https://example.com)");
  });

  it("drops a link with no destination rather than writing an empty one", () => {
    expect(toMarkdown(root(el("P", [el("A", [text("bare")])])))).toBe("bare");
  });

  it("writes headings with the right number of hashes", () => {
    expect(toMarkdown(root(el("H2", [text("Tone")]), el("H3", [text("Detail")]))))
      .toBe("## Tone\n\n### Detail");
  });

  it("numbers ordered lists from one and bullets unordered ones", () => {
    const ul = el("UL", [el("LI", [text("one")]), el("LI", [text("two")])]);
    const ol = el("OL", [el("LI", [text("first")]), el("LI", [text("second")])]);
    expect(toMarkdown(root(ul))).toBe("- one\n- two");
    expect(toMarkdown(root(ol))).toBe("1. first\n2. second");
  });

  it("keeps formatting inside list items", () => {
    const ul = el("UL", [el("LI", [text("be "), el("STRONG", [text("brief")])])]);
    expect(toMarkdown(root(ul))).toBe("- be **brief**");
  });

  it("marks every line of a quote", () => {
    const quote = el("BLOCKQUOTE", [el("P", [text("one")]), el("P", [text("two")])]);
    expect(toMarkdown(root(quote))).toBe("> one\n>\n> two");
  });

  it("separates blocks with one blank line, never more", () => {
    const out = toMarkdown(root(el("P", [text("a")]), el("P", []), el("P", [text("b")])));
    expect(out).toBe("a\n\nb");
  });

  it("turns a line break into a newline", () => {
    expect(toMarkdown(root(el("P", [text("a"), el("BR"), text("b")])))).toBe("a\nb");
  });

  // A browser leaves bare text and stray inline tags at block level all the time.
  it("copes with text that has no block wrapper", () => {
    expect(toMarkdown(root(text("loose"), el("STRONG", [text("bold")])))).toBe("loose\n\n**bold**");
  });

  it("leaves an empty box empty", () => {
    expect(toMarkdown(root(el("P", [el("BR")])))).toBe("");
  });

  it("makes a typed asterisk literal so it survives", () => {
    expect(toMarkdown(root(el("P", [text("2 * 3")])))).toBe("2 \\* 3");
  });
});

describe("filling the editable box from Markdown", () => {
  it("renders bold, italic, strike, code and links as real tags", () => {
    expect(toHtml("**a** *b* ~~c~~ `d` [e](https://x.test)")).toBe(
      "<p><strong>a</strong> <em>b</em> <s>c</s> <code>d</code> <a href=\"https://x.test\">e</a></p>",
    );
  });

  it("renders headings, lists and quotes", () => {
    expect(toHtml("## Tone")).toBe("<h2>Tone</h2>");
    expect(toHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(toHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(toHtml("> said")).toBe("<blockquote><p>said</p></blockquote>");
  });

  it("starts a new list when the kind changes", () => {
    expect(toHtml("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  // Agent files get shared. Their text is content, never markup.
  it("never lets the file's own text become tags", () => {
    expect(toHtml("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("gives an empty field somewhere to put the caret", () => {
    expect(toHtml("")).toBe("<p><br></p>");
  });

  it("keeps an escaped marker literal instead of opening emphasis", () => {
    expect(toHtml("2 \\* 3")).toBe("<p>2 * 3</p>");
  });

  // Agent files are shared, so a link's destination is exactly as untrusted as its text -
  // a scheme this runtime never meant to produce must not reach a real href.
  it("renders a javascript: link as plain text, not a live href", () => {
    expect(toHtml("[click me](javascript:alert%281%29)")).toBe("<p>click me</p>");
  });

  it("renders a data: link as plain text, not a live href", () => {
    expect(toHtml("[x](data:text/html,hello)")).toBe("<p>x</p>");
  });

  it("renders a vbscript: link as plain text, not a live href", () => {
    expect(toHtml("[x](vbscript:msgbox%281%29)")).toBe("<p>x</p>");
  });

  // Browsers drop leading control characters before they read a scheme, so a control character in
  // front of "javascript:" must not hide it from the check.
  it.each(["\u0001", "\u001f", "\u007f", "\u0000"])("sees through a leading control character (%j) in front of a scheme", (control) => {
    expect(toHtml(`[x](${control}javascript:alert%281%29)`)).toBe("<p>x</p>");
  });

  it("still links http, https and mailto", () => {
    expect(toHtml("[a](http://example.com)")).toBe('<p><a href="http://example.com">a</a></p>');
    expect(toHtml("[b](https://example.com)")).toBe('<p><a href="https://example.com">b</a></p>');
    expect(toHtml("[c](mailto:a@example.com)")).toBe('<p><a href="mailto:a@example.com">c</a></p>');
  });

  it("still links a destination with no scheme at all", () => {
    expect(toHtml("[docs](/getting-started)")).toBe('<p><a href="/getting-started">docs</a></p>');
    expect(toHtml("[top](#section)")).toBe('<p><a href="#section">top</a></p>');
  });
});

describe("the round trip", () => {
  // Opening a field and closing it without typing must leave the file byte-identical.
  const samples = [
    "Answer clearly.",
    "Answer **clearly** and *briefly*",
    "## Tone\n\nBe direct.",
    "- one\n- two",
    "1. first\n2. second",
    "> a quote",
    "Use `read_file` for that",
    "See [the docs](https://example.com)",
    "Line one\nline two",
    "",
  ];

  function reparse(markdown: string): NodeLike {
    // Stands in for the browser parsing our HTML: only the shapes toHtml actually emits.
    const html = toHtml(markdown);
    const nodes: NodeLike[] = [];
    const block = /<(p|h[1-4]|ul|ol|blockquote)>(.*?)<\/\1>/g;
    for (let m = block.exec(html); m !== null; m = block.exec(html)) {
      nodes.push(parseInline(m[1]!.toUpperCase(), m[2]!));
    }
    return el("DIV", nodes);
  }

  function parseInline(tag: string, inner: string): NodeLike {
    if (tag === "UL" || tag === "OL") {
      const items = [...inner.matchAll(/<li>(.*?)<\/li>/g)].map((m) => parseInline("LI", m[1]!));
      return el(tag, items);
    }
    if (tag === "BLOCKQUOTE") {
      const paras = [...inner.matchAll(/<p>(.*?)<\/p>/g)].map((m) => parseInline("P", m[1]!));
      return el(tag, paras);
    }
    const kids: NodeLike[] = [];
    const token = /<(strong|em|s|code)>(.*?)<\/\1>|<a href="([^"]*)">(.*?)<\/a>|<br>|([^<]+)/g;
    for (let m = token.exec(inner); m !== null; m = token.exec(inner)) {
      if (m[1] !== undefined) kids.push(el(m[1].toUpperCase(), [text(unescape_(m[2]!))]));
      else if (m[3] !== undefined) kids.push(el("A", [text(unescape_(m[4]!))], { href: m[3] }));
      else if (m[5] !== undefined) kids.push(text(unescape_(m[5])));
      else kids.push(el("BR"));
    }
    return el(tag, kids);
  }

  const unescape_ = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  for (const sample of samples) {
    it(`survives: ${JSON.stringify(sample)}`, () => {
      expect(toMarkdown(reparse(sample))).toBe(sample);
    });
  }
});
