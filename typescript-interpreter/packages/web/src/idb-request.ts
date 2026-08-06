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

export function requestInStore<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = op(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

/**
 * One connection per tab rather than one per call, since an open connection blocks a version
 * upgrade. Dropped when the browser closes it or another tab upgrades; a failed open is not
 * remembered.
 */
export function sharedConnection(connect: () => Promise<IDBDatabase>): () => Promise<IDBDatabase> {
  let connection: Promise<IDBDatabase> | null = null;
  return () => {
    connection ??= connect()
      .then((db) => {
        db.addEventListener("versionchange", () => {
          connection = null;
          db.close();
        });
        db.addEventListener("close", () => {
          connection = null;
        });
        return db;
      })
      .catch((error: unknown) => {
        connection = null;
        throw error;
      });
    return connection;
  };
}
