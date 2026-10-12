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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EMPTY_TEMPLATE, identityFor, initialContent } from "./workspace-content";
import { encodeInlineAfm } from "../../load-paths";
import { previewAgent } from "../../agent-validation";

const AGENT_SOURCE = "---\nname: Saved\n---\n\n# Role\nr\n\n# Instructions\ni\n";

function storageHolding(agents: unknown[]) {
  const map = new Map([["afm.agents.v1", JSON.stringify(agents)]]);
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
}

const params = (query: string) => new URLSearchParams(query);

describe("initialContent", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", storageHolding([{ id: "a1", name: "Saved", description: "", source: AGENT_SOURCE, createdAt: 1, updatedAt: 1, origin: "blank" }]));
  });

  it("starts from a draft when one is handed over", () => {
    expect(initialContent(params("agentId=a1"), "", "draft text")).toBe("draft text");
  });

  it("opens a saved agent by its id", () => {
    expect(initialContent(params("agentId=a1"), "", undefined)).toBe(AGENT_SOURCE);
  });

  it("opens an agent carried in a share link's fragment, or in the older query form", () => {
    const encoded = encodeInlineAfm(AGENT_SOURCE);
    expect(initialContent(params(""), `#afm=${encoded}`, undefined)).toBe(AGENT_SOURCE);
    expect(initialContent(params(`afm=${encoded}`), "", undefined)).toBe(AGENT_SOURCE);
  });

  it("falls back to the empty template for an id that is not in the library", () => {
    expect(initialContent(params("agentId=gone"), "", undefined)).toBe(EMPTY_TEMPLATE);
  });

  it("falls back to the empty template for a share link that cannot be decoded", () => {
    expect(initialContent(params(""), "#afm=%%%not-base64", undefined)).toBe(EMPTY_TEMPLATE);
  });

  it("gives the empty template when there is nothing to open", () => {
    expect(initialContent(params(""), "", undefined)).toBe(EMPTY_TEMPLATE);
  });

  it.each(["agentId=", "agentId=missing", "code=fixture&state=fixture"])("does not recover an absent saved agent from %s", (query) => {
    const search = params(query);
    const before = search.toString();
    expect(initialContent(search, "", undefined)).toBe(EMPTY_TEMPLATE);
    expect(search.toString()).toBe(before);
  });

  it.each(["agentId=a1&agentId=missing", "agentId=a1&code=fixture&state=fixture&keep=1&keep=2"])("opens the first saved id without rewriting %s", (query) => {
    const search = params(query);
    const before = search.toString();
    expect(initialContent(search, "", undefined)).toBe(AGENT_SOURCE);
    expect(search.toString()).toBe(before);
  });

  it("prefers a saved agent over inline content, but falls back to inline content for a missing id", () => {
    const hash = `#afm=${encodeInlineAfm("inline source")}`;
    expect(initialContent(params("agentId=a1"), hash, undefined)).toBe(AGENT_SOURCE);
    expect(initialContent(params("agentId=missing"), hash, undefined)).toBe("inline source");
  });

  it("prefers the fragment over a legacy inline query even when the fragment is malformed", () => {
    const search = params(`afm=${encodeInlineAfm(AGENT_SOURCE)}`);
    expect(initialContent(search, `#afm=${encodeInlineAfm("fragment source")}`, undefined)).toBe("fragment source");
    expect(initialContent(search, "#afm=%%%not-base64", undefined)).toBe(EMPTY_TEMPLATE);
  });

  it("preserves an explicitly empty draft instead of falling back to the URL", () => {
    expect(initialContent(params("agentId=a1"), `#afm=${encodeInlineAfm(AGENT_SOURCE)}`, "")).toBe("");
  });

  it("leaves remote fetching to the effect rather than changing initial content", () => {
    expect(initialContent(params("file=https://example.test/agent.afm.md&agentId=a1"), "", undefined)).toBe(AGENT_SOURCE);
    expect(initialContent(params("file=https://example.test/agent.afm.md"), "", undefined)).toBe(EMPTY_TEMPLATE);
  });
});

describe("EMPTY_TEMPLATE", () => {
  it("is a valid file except for the two sections left for the person to write", () => {
    const preview = previewAgent(EMPTY_TEMPLATE);
    expect(preview.ok).toBe(false);
    expect(preview.ok ? "" : preview.error).toMatch(/Role/);
  });
});

describe("identityFor", () => {
  it("tells one agent from another, so a real change reloads and an edit does not", () => {
    expect(identityFor(params(""), "", "abc")).toBe("draft:abc");
    expect(identityFor(params("file=https://x/y.afm.md"), "", undefined)).toBe("file:https://x/y.afm.md");
    expect(identityFor(params("agentId=a1"), "", undefined)).toBe("a1");
    expect(identityFor(params(""), "#afm=zzz", undefined)).toBe("zzz");
    expect(identityFor(params(""), "", undefined)).toBe("blank");
  });

  it("orders identity by draft, remote file, saved id, then inline content", () => {
    const search = params("file=https://example.test/a&agentId=a1&afm=query");
    expect(identityFor(search, "#afm=fragment", "")).toBe("draft:");
    expect(identityFor(search, "#afm=fragment", undefined)).toBe("file:https://example.test/a");
    expect(identityFor(params("agentId=a1&afm=query"), "#afm=fragment", undefined)).toBe("a1");
    expect(identityFor(params("afm=query"), "#afm=fragment", undefined)).toBe("fragment");
  });

  it("distinguishes an empty id from no id and ignores callback parameters", () => {
    expect(identityFor(params("agentId=&code=fixture&state=fixture"), "", undefined)).toBe("");
    expect(identityFor(params("code=fixture&state=fixture"), "", undefined)).toBe("blank");
    expect(identityFor(params("agentId=a1&agentId=a2&code=fixture&state=fixture"), "", undefined)).toBe("a1");
  });
});
