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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearStoredHistory,
  mergeHistory,
  withHistoryEntry,
  withImportedHistory,
  withoutAgentHistory,
} from "./history-store";
import type { HistoryEntry } from "./history-store";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "h1",
    agentId: null,
    agentName: "Test",
    agentSource: "",
    messages: [],
    tokenCount: 0,
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("mergeHistory", () => {
  it("sorts the merged result by recency descending", () => {
    const merged = mergeHistory(
      [entry({ id: "old", updatedAt: 100 })],
      [entry({ id: "new", updatedAt: 300 }), entry({ id: "mid", updatedAt: 200 })],
    );
    expect(merged.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps the newer of two colliding entries by id", () => {
    const merged = mergeHistory(
      [entry({ id: "h1", tokenCount: 5, updatedAt: 100 })],
      [entry({ id: "h1", tokenCount: 99, updatedAt: 200 })],
    );
    expect(merged).toEqual([entry({ id: "h1", tokenCount: 99, updatedAt: 200 })]);
  });

  it("does not roll a newer conversation back during Undo", () => {
    const newer = entry({ updatedAt: 200, tokenCount: 99 });
    expect(mergeHistory([newer], [entry({ updatedAt: 100 })])).toEqual([newer]);
  });

  it("takes the imported entry on an equal timestamp", () => {
    const imported = entry({ tokenCount: 99 });
    expect(mergeHistory([entry()], [imported])).toEqual([imported]);
  });
});

describe("the conversations kept in memory", () => {
  it("adds a conversation", () => {
    expect(withHistoryEntry([], entry({ id: "c1", agentName: "Writer" })).map((e) => e.agentName)).toEqual(["Writer"]);
  });

  it("lists conversations newest first", () => {
    let entries: HistoryEntry[] = [];
    entries = withHistoryEntry(entries, entry({ id: "old", updatedAt: 100 }));
    entries = withHistoryEntry(entries, entry({ id: "new", updatedAt: 300 }));
    entries = withHistoryEntry(entries, entry({ id: "mid", updatedAt: 200 }));
    expect(entries.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("replaces a conversation rather than duplicating it", () => {
    const after = withHistoryEntry([entry({ id: "c1", tokenCount: 1, updatedAt: 100 })], entry({ id: "c1", tokenCount: 2, updatedAt: 200 }));
    expect(after).toHaveLength(1);
    expect(after[0]?.tokenCount).toBe(2);
  });

  it("does not change the list it was given", () => {
    const before = [entry({ id: "c1" })];
    withHistoryEntry(before, entry({ id: "c2" }));
    withoutAgentHistory(before, "A");
    withImportedHistory(before, [entry({ id: "c3" })]);
    expect(before.map((e) => e.id)).toEqual(["c1"]);
  });

  it("removes every conversation of one agent and leaves the rest alone", () => {
    const keep = [entry({ id: "unassociated" }), entry({ id: "other", agentId: "B" })];
    const all = [...keep, entry({ id: "a1", agentId: "A" }), entry({ id: "a2", agentId: "A" })];
    expect(withoutAgentHistory(all, "A")).toEqual(keep);
    expect(withoutAgentHistory(keep, "missing")).toEqual(keep);
  });

  it("keeps only the newest 200 when saving", () => {
    const entries = Array.from({ length: 200 }, (_, index) => entry({ id: `c${index}`, updatedAt: index }));
    const saved = withHistoryEntry(entries, entry({ id: "latest", updatedAt: 500 }));
    expect(saved).toHaveLength(200);
    expect(saved[0]?.id).toBe("latest");
    expect(saved.some((e) => e.id === "c0")).toBe(false);
  });

  it("keeps only the newest 200 when restoring", () => {
    const imported = Array.from({ length: 201 }, (_, index) => entry({ id: `c${index}`, updatedAt: index }));
    const restored = withImportedHistory([], imported);
    expect(restored).toHaveLength(200);
    expect(restored[0]?.id).toBe("c200");
  });

  it("restores deleted conversations without disturbing the ones still there", () => {
    const still = entry({ id: "still", updatedAt: 300 });
    const restored = withImportedHistory([still], [entry({ id: "back", updatedAt: 100 })]);
    expect(restored.map((e) => e.id)).toEqual(["still", "back"]);
  });

  it("keeps a message's attached image", () => {
    const withImage = entry({
      id: "c1",
      messages: [{ kind: "user", id: 1, text: "look", images: [{ name: "shot.png", mediaType: "image/png", data: "AAAA" }] }],
    });
    expect(withHistoryEntry([], withImage)[0]?.messages[0]).toMatchObject({ images: [{ name: "shot.png", data: "AAAA" }] });
  });

  it("never touches the browser's storage", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), key: vi.fn(), length: 0 };
    const database = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("indexedDB", database);
    try {
      withImportedHistory(withoutAgentHistory(withHistoryEntry([], entry()), "A"), [entry({ id: "c2" })]);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(database.open).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("clearStoredHistory", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("deletes the conversations earlier versions left in the browser", () => {
    const storage = { removeItem: vi.fn() };
    const database = { deleteDatabase: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("indexedDB", database);
    clearStoredHistory();
    expect(database.deleteDatabase).toHaveBeenCalledWith("afm-history");
    expect(storage.removeItem).toHaveBeenCalledWith("afm.history.v1");
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);
    expect(() => clearStoredHistory()).not.toThrow();
  });
});
