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

import type { UiMessage } from "./chat-state";
import { requestInStore, sharedConnection } from "./idb-request";

export interface HistoryEntry {
  id: string;
  agentId: string | null;
  agentName: string;
  agentSource: string;
  messages: UiMessage[];
  tokenCount: number;
  startedAt: number;
  updatedAt: number;
}

/**
 * Conversations live in IndexedDB rather than localStorage, since messages can carry base64 images
 * that pass localStorage's ~5MB limit. One record per conversation, keyed by id, so sending a
 * message rewrites one record.
 */
const DB_NAME = "afm-history";
const STORE = "conversations";
const HISTORY_MAX = 200;
/** Where conversations lived before; read once during the upgrade below. */
const LEGACY_KEY = "afm.history.v1";

function legacyEntries(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.id === "string") : [];
  } catch {
    return [];
  }
}

const openDb = sharedConnection(connect);

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "id" });
      // Carried over inside the upgrade transaction; the old copy is dropped only once it commits.
      const legacy = legacyEntries();
      for (const entry of legacy) store.put(entry);
      if (legacy.length > 0) {
        request.transaction?.addEventListener("complete", () => {
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            // Keeping a stale copy is harmless; losing the migrated one is not.
          }
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return requestInStore<T>(db, STORE, mode, op);
}

function byRecency(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readAll(db: IDBDatabase): Promise<HistoryEntry[]> {
  return byRecency(await run<HistoryEntry[]>(db, "readonly", (store) => store.getAll()));
}

/**
 * Every caller renders the whole list afterwards, so each returns it. A failed read returns an
 * empty list rather than throwing, so a broken history cannot stop the app.
 */
export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    return await readAll(await openDb());
  } catch {
    return [];
  }
}

async function writeAll(db: IDBDatabase, entries: HistoryEntry[]): Promise<HistoryEntry[]> {
  const ordered = byRecency(entries);
  const keep = ordered.slice(0, HISTORY_MAX);
  const kept = new Set(keep.map((entry) => entry.id));
  await Promise.all(
    ordered
      .filter((entry) => !kept.has(entry.id))
      .map((entry) => run(db, "readwrite", (store) => store.delete(entry.id))),
  );
  return keep;
}

// A change that fails part-way returns the list as it stands rather than throwing.
async function changeHistory(change: (db: IDBDatabase) => Promise<HistoryEntry[]>): Promise<HistoryEntry[]> {
  try {
    return await change(await openDb());
  } catch {
    return loadHistory();
  }
}

export function upsertHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry[]> {
  return changeHistory(async (db) => {
    await run(db, "readwrite", (store) => store.put(entry));
    return writeAll(db, await readAll(db));
  });
}

export function removeHistoryEntry(id: string): Promise<HistoryEntry[]> {
  return changeHistory(async (db) => {
    await run(db, "readwrite", (store) => store.delete(id));
    return readAll(db);
  });
}

export function removeHistoryEntriesForAgent(agentId: string): Promise<HistoryEntry[]> {
  return changeHistory(async (db) => {
    const doomed = (await readAll(db)).filter((entry) => entry.agentId === agentId);
    await Promise.all(doomed.map((entry) => run(db, "readwrite", (store) => store.delete(entry.id))));
    return readAll(db);
  });
}

export function clearHistory(): Promise<HistoryEntry[]> {
  return changeHistory(async (db) => {
    await run(db, "readwrite", (store) => store.clear());
    return [];
  });
}

export async function branchFrom(entry: HistoryEntry): Promise<HistoryEntry> {
  const now = Date.now();
  const branched: HistoryEntry = { ...entry, id: crypto.randomUUID(), startedAt: now, updatedAt: now };
  await upsertHistoryEntry(branched);
  return branched;
}

// Restores deleted conversations without disturbing newer ones: an existing entry wins unless the
// restored copy is newer, so an undo never rolls a conversation back. Pure, so the rule is testable
// without a database.
export function mergeHistory(existing: HistoryEntry[], imported: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of imported) {
    const current = byId.get(item.id);
    if (current === undefined || item.updatedAt >= current.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return byRecency([...byId.values()]);
}

export function importHistoryEntries(imported: HistoryEntry[]): Promise<HistoryEntry[]> {
  return changeHistory(async (db) => {
    const existing = await readAll(db);
    const merged = mergeHistory(existing, imported);
    // Only the entries the merge took from `imported` are written, so an undo does not re-save the
    // whole store.
    const unchanged = new Map(existing.map((entry) => [entry.id, entry]));
    const changed = merged.filter((entry) => unchanged.get(entry.id) !== entry);
    await Promise.all(changed.map((entry) => run(db, "readwrite", (store) => store.put(entry))));
    return writeAll(db, merged);
  });
}
