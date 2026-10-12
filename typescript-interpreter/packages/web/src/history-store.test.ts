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
import { mergeHistory } from "./history-store";
import type { HistoryEntry } from "./history-store";

let db: typeof import("./history-store");
let fake: ReturnType<typeof fakeIndexedDb>;

async function freshStore(storedInLocalStorage: Record<string, string> = {}): Promise<void> {
  vi.resetModules();
  fake = fakeIndexedDb();
  vi.stubGlobal("indexedDB", fake);
  vi.stubGlobal("localStorage", fakeLocalStorage(storedInLocalStorage));
  db = await import("./history-store");
}

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

function fakeIndexedDb(existing: Record<string, HistoryEntry> = {}) {
  const data = new Map<string, HistoryEntry>(Object.entries(existing));
  const settle = <T,>(result: T) => {
    const request = { result, onsuccess: null as null | (() => void), onerror: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const puts: string[] = [];
  const store = {
    put: (value: HistoryEntry) => settle(void (puts.push(value.id), data.set(value.id, value))),
    getAll: () => settle([...data.values()]),
    delete: (key: string) => settle(void data.delete(key)),
  };
  const db = {
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
    addEventListener: () => {},
    close: () => {},
  };

  let created = false;
  let opened = 0;
  return {
    data,
    puts,
    get opened() {
      return opened;
    },
    open: () => {
      opened += 1;
      const complete: (() => void)[] = [];
      const request = {
        result: db,
        transaction: { addEventListener: (_: string, fn: () => void) => complete.push(fn) },
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
      };
      queueMicrotask(() => {
        if (!created) {
          created = true;
          request.onupgradeneeded?.();
          for (const fn of complete) fn();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
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

describe("the conversation store", () => {
  beforeEach(async () => {
    await freshStore();
  });

  it("saves a conversation and reads it back", async () => {
    await db.upsertHistoryEntry(entry({ id: "c1", agentName: "Writer" }));
    expect((await db.loadHistory()).map((e) => e.agentName)).toEqual(["Writer"]);
  });

  it("returns conversations newest first", async () => {
    await db.upsertHistoryEntry(entry({ id: "old", updatedAt: 100 }));
    await db.upsertHistoryEntry(entry({ id: "new", updatedAt: 300 }));
    await db.upsertHistoryEntry(entry({ id: "mid", updatedAt: 200 }));
    expect((await db.loadHistory()).map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("replaces a conversation rather than duplicating it", async () => {
    await db.upsertHistoryEntry(entry({ id: "c1", tokenCount: 1, updatedAt: 100 }));
    const after = await db.upsertHistoryEntry(entry({ id: "c1", tokenCount: 2, updatedAt: 200 }));
    expect(after).toHaveLength(1);
    expect(after[0]?.tokenCount).toBe(2);
  });

  it("leaves unassociated and other agents' conversations alone when deleting an agent", async () => {
    const keep = [entry({ id: "unassociated" }), entry({ id: "other", agentId: "B" })];
    await db.importHistoryEntries([...keep, entry({ id: "drop", agentId: "A" })]);
    expect(await db.removeHistoryEntriesForAgent("A")).toEqual(keep);
    expect(await db.removeHistoryEntriesForAgent("missing")).toEqual(keep);
    expect(await db.loadHistory()).toEqual(keep);
  });

  it("retains the newest 200 entries on both restore and save", async () => {
    const imported = Array.from({ length: 201 }, (_, index) => entry({ id: `c${index}`, updatedAt: index }));
    const restored = await db.importHistoryEntries(imported);
    expect(restored).toHaveLength(200);
    expect(restored[0]?.id).toBe("c200");
    expect(fake.data.has("c0")).toBe(false);
    const saved = await db.upsertHistoryEntry(entry({ id: "latest", updatedAt: 202 }));
    expect(saved).toHaveLength(200);
    expect(saved[0]?.id).toBe("latest");
    expect(fake.data.has("c1")).toBe(false);
    expect(await db.loadHistory()).toEqual(saved);
  });

  it("removes every conversation of one agent and preserves the rest", async () => {
    await db.upsertHistoryEntry(entry({ id: "a1", agentId: "A" }));
    await db.upsertHistoryEntry(entry({ id: "a2", agentId: "A" }));
    await db.upsertHistoryEntry(entry({ id: "b1", agentId: "B" }));

    expect((await db.removeHistoryEntriesForAgent("A")).map((e) => e.id)).toEqual(["b1"]);
    expect((await db.loadHistory()).map((e) => e.id)).toEqual(["b1"]);
    expect(await db.removeHistoryEntriesForAgent("B")).toEqual([]);
    expect(await db.loadHistory()).toEqual([]);
  });

  it("keeps a message's attached image", async () => {
    const withImage = entry({
      id: "c1",
      messages: [
        { kind: "user", id: 1, text: "look", images: [{ name: "shot.png", mediaType: "image/png", data: "AAAA" }] },
      ],
    });
    await db.upsertHistoryEntry(withImage);
    const [loaded] = await db.loadHistory();
    expect(loaded?.messages[0]).toMatchObject({ images: [{ name: "shot.png", data: "AAAA" }] });
  });

  it("restores deleted conversations without disturbing the ones still there", async () => {
    const deleted = [entry({ id: "c1", updatedAt: 200 }), entry({ id: "c2", updatedAt: 100 })];
    await db.upsertHistoryEntry(entry({ id: "other", updatedAt: 150 }));

    const after = await db.importHistoryEntries(deleted);
    expect(after.map((e) => e.id)).toEqual(["c1", "other", "c2"]);
  });

  it("writes back only the restored conversations, not the whole store", async () => {
    await db.upsertHistoryEntry(entry({ id: "other", updatedAt: 150 }));
    fake.puts.length = 0;

    await db.importHistoryEntries([entry({ id: "c1", updatedAt: 200 })]);
    expect(fake.puts).toEqual(["c1"]);
  });

  it("opens the database once, however many operations run", async () => {
    await db.upsertHistoryEntry(entry({ id: "a", agentId: "A" }));
    await db.loadHistory();
    await db.removeHistoryEntriesForAgent("A");
    await db.loadHistory();
    expect(fake.opened).toBe(1);
  });

  it("survives a store that cannot be opened, rather than taking the app down", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null as null | (() => void) };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    });
    expect(await db.loadHistory()).toEqual([]);
    expect(await db.upsertHistoryEntry(entry())).toEqual([]);
  });
});

describe("moving conversations off localStorage", () => {
  const legacy = [entry({ id: "c1", agentName: "Older", updatedAt: 100 })];

  beforeEach(async () => {
    await freshStore({ "afm.history.v1": JSON.stringify(legacy) });
  });

  it("carries the existing conversations over on first open", async () => {
    expect((await db.loadHistory()).map((e) => e.agentName)).toEqual(["Older"]);
  });

  it("drops the old copy once the move has committed", async () => {
    await db.loadHistory();
    expect(localStorage.getItem("afm.history.v1")).toBeNull();
  });

  it("ignores a malformed old copy instead of failing to open", async () => {
    await freshStore({ "afm.history.v1": "not json" });
    expect(await db.loadHistory()).toEqual([]);
  });
});
