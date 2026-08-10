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
// lives on disk (passkey/store), useless without the authenticator, and is decrypted back here on
// demand. Only the main thread can run a passkey ceremony, so opening a sealed value is a round
// trip: ask (passkey-unlock-request), receive the derived key (resolveUnlock), decrypt.
export interface WorkerSecretStore {
  memoryPort: SecretPort;
  passkeyPort: SecretPort;
  // Backs an OAuth refresh token, so a fresh sign-in and a remembered one use the same path.
  refreshStore: KeyValueStore;
  loadSealedRefresh(refreshKey: string): Promise<void>;
  isSaved(name: string): Promise<boolean>;
  touch(): void;
  set(name: string, value: string): void;
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
  resolveUnlock(id: string, key: CryptoKey | null): void;
  postNames(): void;
  postSealedNames(): void;
}

const AUTO_LOCK_MS = 5 * 60 * 1000;

export function createWorkerSecretStore(emit: (message: ServerMessage) => void): WorkerSecretStore {
  // No prototype, so names like "constructor" or "toString" are never found by accident.
  const values: Record<string, string> = Object.create(null);
  // Only names decrypted from a sealed copy auto-lock; a typed value has nothing to unlock from.
  const unlockedNames = new Set<string>();
  let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

  // The key a sealed name was last opened or saved with, so a later rotation can re-seal without a
  // passkey prompt. Auto-lock drops this too, except for a name refreshStore.set has written: an
  // OAuth session keeps rotating tokens after the lock, and this key never decrypts anything, only
  // encrypts the next value.
  const sealingKeys = new Map<string, { key: CryptoKey; credentialId: Uint8Array<ArrayBuffer>; salt: Uint8Array<ArrayBuffer> }>();
  const refreshNames = new Set<string>();

  const pendingUnlocks = new Map<string, (key: CryptoKey | null) => void>();
  let unlockCounter = 0;

  function postNames(): void {
    emit({ type: "secrets-list", names: Object.keys(values) });
  }

  function postSealedNames(): void {
    void listSealedNames()
      .then((names) => emit({ type: "passkey-list", names }))
      .catch(() => emit({ type: "passkey-list", names: [] }));
  }

  function lock(): void {
    if (unlockedNames.size === 0) return;
    for (const name of unlockedNames) {
      delete values[name];
      if (!refreshNames.has(name)) sealingKeys.delete(name);
    }
    unlockedNames.clear();
    postNames();
  }

  function touch(): void {
    if (autoLockTimer !== null) clearTimeout(autoLockTimer);
    autoLockTimer = unlockedNames.size === 0 ? null : setTimeout(lock, AUTO_LOCK_MS);
  }

  // A store error reads as nothing saved, never a throw.
  const sealedBlob = (name: string) => loadBlob(name).catch(() => null);

  function requestUnlock(name: string, blob: StoredSecret): Promise<CryptoKey | null> {
    const id = `passkey-${++unlockCounter}`;
    return new Promise((resolve) => {
      pendingUnlocks.set(id, resolve);
      emit({ type: "passkey-unlock-request", id, name, credentialId: blob.credentialId, salt: blob.salt });
    });
  }

  // The last step of every unlock: sealed bytes become a usable value, or null if the key does not
  // fit.
  async function decryptInto(name: string, key: CryptoKey, blob: StoredSecret): Promise<string | null> {
    try {
      const value = await decryptString(key, blob);
      values[name] = value;
      unlockedNames.add(name);
      sealingKeys.set(name, { key, credentialId: blob.credentialId, salt: blob.salt });
      touch();
      postNames();
      return value;
    } catch {
      return null;
    }
  }

  const passkeyPort: SecretPort = {
    async resolve(ref) {
      const blob = await sealedBlob(ref.name);
      if (blob === null) return { status: "unresolved", reason: `'${ref.name}' has no saved copy` };
      const key = await requestUnlock(ref.name, blob);
      if (key === null) return { status: "unresolved", reason: `'${ref.name}' was not unlocked` };
      const value = await decryptInto(ref.name, key, blob);
      return value === null
        ? { status: "unresolved", reason: `'${ref.name}' could not be unlocked on this device` }
        : { status: "resolved", value };
    },
  };

  const refreshStore: KeyValueStore = {
    get: (key) => values[key] ?? null,
    // Awaited by persist() so a caller that reads the sealed copy right after a rotation (a
    // reload, moments later) sees the new value rather than a stale one still on disk.
    set: (key, value) => {
      values[key] = value;
      refreshNames.add(key);
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
    passkeyPort,
    refreshStore,
    touch,
    postNames,
    postSealedNames,

    async loadSealedRefresh(refreshKey) {
      if ((values[refreshKey] ?? "") !== "") return;
      const blob = await sealedBlob(refreshKey);
      if (blob === null) return;
      const key = await requestUnlock(refreshKey, blob);
      // A sealed copy that will not open sends the caller to a fresh sign-in.
      if (key !== null) await decryptInto(refreshKey, key, blob);
    },

    async isSaved(name) {
      return (values[name] ?? "") !== "" || (await sealedBlob(name)) !== null;
    },

    set(name, value) {
      if (value === "") return;
      values[name] = value;
      unlockedNames.delete(name);
      postNames();
    },

    remove(name) {
      delete values[name];
      unlockedNames.delete(name);
      postNames();
    },

    acceptUnlock(name, key) {
      void sealedBlob(name).then((blob) => (blob === null ? null : decryptInto(name, key, blob)));
    },

    seal(name, key, credentialId, salt) {
      const value = values[name] ?? "";
      if (value === "") return;
      void encryptString(key, value)
        .then((sealed) => saveBlob(name, { ...sealed, credentialId, salt }))
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
          await saveBlob(name, { ...sealed, credentialId, salt });
          sealingKeys.set(name, { key: to, credentialId, salt });
        })
        .catch(() => {});
    },

    forgetSealed(name) {
      sealingKeys.delete(name);
      void removeBlob(name).then(postSealedNames).catch(() => {});
    },

    resolveUnlock(id, key) {
      const settle = pendingUnlocks.get(id);
      if (settle !== undefined) {
        pendingUnlocks.delete(id);
        settle(key);
      }
    },
  };
}
