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

import { requestInStore, sharedConnection } from "../idb-request";
import type { SealedValue } from "./crypto";

const DB_NAME = "afm-passkey-secrets";
const STORE = "secrets";

export interface StoredSecret extends SealedValue {
  credentialId: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  hosts?: string[];
}

const openDb = sharedConnection(
  () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }),
);

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return requestInStore<T>(db, STORE, mode, op);
}

export async function saveBlob(name: string, blob: StoredSecret): Promise<void> {
  const db = await openDb();
  await run(db, "readwrite", (store) => store.put(blob, name));
}

export async function loadBlob(name: string): Promise<StoredSecret | null> {
  const db = await openDb();
  return (await run<StoredSecret | undefined>(db, "readonly", (store) => store.get(name))) ?? null;
}

export async function listNames(): Promise<string[]> {
  const db = await openDb();
  const keys = await run<IDBValidKey[]>(db, "readonly", (store) => store.getAllKeys());
  return keys.filter((key): key is string => typeof key === "string");
}

export async function removeBlob(name: string): Promise<void> {
  const db = await openDb();
  await run(db, "readwrite", (store) => store.delete(name));
}
