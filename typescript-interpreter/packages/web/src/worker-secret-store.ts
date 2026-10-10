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

import type { SecretPort } from "@afm/engine";
import { configSecretPort } from "@afm/adapter-secret";
import type { KeyValueStore } from "@afm/adapter-auth";
import { encryptString, decryptString } from "./passkey/crypto";
import { saveBlob, removeBlob, loadBlob, listNames as listSealedNames, type StoredSecret } from "./passkey/store";
import type { ServerMessage } from "./protocol";

// Holds secret plaintext in memory for the life of the tab. With a passkey, a sealed copy also
// lives on disk (passkey/store), useless without the authenticator. Only the main thread can run a
// passkey ceremony, so it opens every sealed value up front and hands over one derived key per
// name (acceptUnlock); the worker only decrypts. A value is approved for the hosts it was entered
// for, and that list travels with the sealed copy.
export interface WorkerSecretStore {
  memoryPort: SecretPort;
  // Backs an OAuth refresh token, so a fresh sign-in and a remembered one use the same path.
  refreshStore: KeyValueStore;
  approvedFor(name: string, host: string | undefined): boolean;
  opened(): Promise<void>;
  set(name: string, value: string, host?: string): void;
  remove(name: string): void;
  acceptUnlock(name: string, key: CryptoKey): void;
  seal(name: string, key: CryptoKey, credentialId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): void;
  reseal(
    name: string,
    from: CryptoKey,
    to: CryptoKey,
    credentialId: Uint8Array<ArrayBuffer>,
    salt: Uint8Array<ArrayBuffer>,
  ): void;
  forgetSealed(name: string): void;
  postNames(): void;
  postSealedNames(): void;
}

export function createWorkerSecretStore(emit: (message: ServerMessage) => void): WorkerSecretStore {
  // No prototype, so names like "constructor" or "toString" are never found by accident.
  const values: Record<string, string> = Object.create(null);
  const approvals = new Map<string, Set<string>>();

  // The key a sealed name was last opened or saved with, so a later rotation can re-seal without a
  // passkey prompt.
  const sealingKeys = new Map<string, { key: CryptoKey; credentialId: Uint8Array<ArrayBuffer>; salt: Uint8Array<ArrayBuffer> }>();

  // Keys the main thread sent are still being opened. Whatever reads a secret waits for them, so a
  // run does not find a name empty that the same unlock is about to fill.
  let unlocking: Promise<unknown> = Promise.resolve();

  function postNames(): void {
    emit({ type: "secrets-list", names: Object.keys(values) });
  }

  function postSealedNames(): void {
    void listSealedNames()
      .then((names) => emit({ type: "passkey-list", names }))
      .catch(() => emit({ type: "passkey-list", names: [] }));
  }

  // A store error reads as nothing saved, never a throw.
  const sealedBlob = (name: string) => loadBlob(name).catch(() => null);

  // The last step of every unlock: sealed bytes become a usable value, or null if the key does not
  // fit.
  async function decryptInto(name: string, key: CryptoKey, blob: StoredSecret): Promise<string | null> {
    try {
      const value = await decryptString(key, blob);
      values[name] = value;
      approvals.set(name, new Set(blob.hosts));
      sealingKeys.set(name, { key, credentialId: blob.credentialId, salt: blob.salt });
      postNames();
      return value;
    } catch {
      return null;
    }
  }

  const refreshStore: KeyValueStore = {
    get: (key) => values[key] ?? null,
    // Awaited by persist() so a caller that reads the sealed copy right after a rotation (a
    // reload, moments later) sees the new value rather than a stale one still on disk.
    set: (key, value) => {
      values[key] = value;
      postNames();
      const sealing = sealingKeys.get(key);
      if (sealing === undefined) return;
      return encryptString(sealing.key, value)
        .then((sealed) => (values[key] === value ? saveBlob(key, { ...sealed, credentialId: sealing.credentialId, salt: sealing.salt }) : undefined))
        .catch(() => {});
    },
    remove: (key) => {
      delete values[key];
      sealingKeys.delete(key);
      postNames();
    },
  };

  return {
    memoryPort: configSecretPort(values),
    refreshStore,
    postNames,
    postSealedNames,

    approvedFor: (name, host) => host !== undefined && approvals.get(name)?.has(host) === true,

    opened: () => unlocking.then(() => undefined),

    set(name, value, host) {
      if (value === "") return;
      values[name] = value;
      approvals.set(name, new Set(host === undefined ? [] : [host]));
      postNames();
    },

    remove(name) {
      delete values[name];
      approvals.delete(name);
      postNames();
    },

    acceptUnlock(name, key) {
      unlocking = unlocking
        .then(() => sealedBlob(name))
        .then((blob) => (blob === null ? null : decryptInto(name, key, blob)));
    },

    seal(name, key, credentialId, salt) {
      const value = values[name] ?? "";
      if (value === "") return;
      const hosts = [...(approvals.get(name) ?? [])];
      void encryptString(key, value)
        .then((sealed) => saveBlob(name, { ...sealed, credentialId, salt, hosts }))
        .then(() => {
          sealingKeys.set(name, { key, credentialId, salt });
          postSealedNames();
        })
        .catch(() => emit({ type: "notice", text: `${name} could not be saved for next time. It still works for this tab.` }));
    },

    // The value is only ever decrypted here and never enters memory; a copy that will not open
    // stays under its own passkey.
    reseal(name, from, to, credentialId, salt) {
      void sealedBlob(name)
        .then(async (blob) => {
          if (blob === null) return;
          const sealed = await encryptString(to, await decryptString(from, blob));
          await saveBlob(name, { ...sealed, credentialId, salt, hosts: blob.hosts });
          sealingKeys.set(name, { key: to, credentialId, salt });
        })
        .catch(() => {});
    },

    forgetSealed(name) {
      sealingKeys.delete(name);
      void removeBlob(name).then(postSealedNames).catch(() => {});
    },
  };
}
