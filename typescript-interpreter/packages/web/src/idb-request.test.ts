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

import { describe, it, expect, vi } from "vitest";
import { requestInStore, sharedConnection } from "./idb-request";

function fakeDatabase() {
  const listeners = new Map<string, (() => void)[]>();
  const db = {
    close: vi.fn(),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  return { db: db as unknown as IDBDatabase, close: db.close, fire: (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener()) };
}

describe("sharedConnection", () => {
  it("opens the database once however many callers ask", async () => {
    const { db } = fakeDatabase();
    const open = vi.fn(async () => db);
    const connect = sharedConnection(open);
    expect(await Promise.all([connect(), connect(), connect()])).toEqual([db, db, db]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh connection after the browser closes the old one", async () => {
    const first = fakeDatabase();
    const second = fakeDatabase();
    const open = vi.fn().mockResolvedValueOnce(first.db).mockResolvedValueOnce(second.db);
    const connect = sharedConnection(open);
    expect(await connect()).toBe(first.db);
    first.fire("close");
    expect(await connect()).toBe(second.db);
  });

  it("lets go when another tab needs to upgrade the database, then reconnects", async () => {
    const first = fakeDatabase();
    const second = fakeDatabase();
    const open = vi.fn().mockResolvedValueOnce(first.db).mockResolvedValueOnce(second.db);
    const connect = sharedConnection(open);
    await connect();
    first.fire("versionchange");
    expect(first.close).toHaveBeenCalled();
    expect(await connect()).toBe(second.db);
  });

  it("does not remember a failed open, so the next call can try again", async () => {
    const { db } = fakeDatabase();
    const open = vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValueOnce(db);
    const connect = sharedConnection(open);
    await expect(connect()).rejects.toThrow("blocked");
    expect(await connect()).toBe(db);
  });
});

describe("requestInStore", () => {
  function storeWith(request: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void }) {
    return {
      transaction: () => ({ objectStore: () => ({}) }),
      request,
    } as unknown as IDBDatabase & { request: typeof request };
  }

  it("resolves with what the request found", async () => {
    const request: { result?: unknown; onsuccess?: () => void } = {};
    const db = storeWith(request);
    const pending = requestInStore(db, "s", "readonly", () => request as unknown as IDBRequest);
    request.result = "found";
    request.onsuccess?.();
    expect(await pending).toBe("found");
  });

  it("rejects with the request's error", async () => {
    const request: { error?: unknown; onerror?: () => void } = {};
    const db = storeWith(request);
    const pending = requestInStore(db, "s", "readwrite", () => request as unknown as IDBRequest);
    request.error = new Error("quota");
    request.onerror?.();
    await expect(pending).rejects.toThrow("quota");
  });
});
