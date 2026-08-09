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

import type { ClientMessage } from "../protocol";
import { deriveAesKeyFromPrf, randomSalt } from "./crypto";
import { loadBlob, listNames, type StoredSecret } from "./store";
import { enrollPasskey } from "./enroll";
import { unlockWithPasskey } from "./unlock";
import { knownCredentialId, rememberCredentialId, forgetCredentialId } from "./credential";

// Everything about protecting saved secrets behind one passkey. Sealing, unlocking and
// consolidating only derive keys and hand them to the worker, which alone holds the plaintext.
// Ceremonies must run straight from a click.

type Post = (message: ClientMessage) => void;

// A pending unlock the worker is waiting on.
export interface UnlockRequest {
  id: string;
  name: string;
  credentialId: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

interface SealedEntry {
  name: string;
  blob: StoredSecret;
}

interface Opened {
  credentialId: Uint8Array<ArrayBuffer>;
  prfOutput: BufferSource;
}

function sameBytes(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

async function sealedEntries(): Promise<SealedEntry[]> {
  const entries: SealedEntry[] = [];
  for (const name of await listNames()) {
    const blob = await loadBlob(name);
    if (blob !== null) entries.push({ name, blob });
  }
  return entries;
}

// The distinct passkeys some blobs were sealed under, normally one.
function distinctCredentials(entries: SealedEntry[]): Uint8Array<ArrayBuffer>[] {
  const ids: Uint8Array<ArrayBuffer>[] = [];
  for (const { blob } of entries) {
    if (!ids.some((id) => sameBytes(id, blob.credentialId))) ids.push(blob.credentialId);
  }
  return ids;
}

async function hasSecretsUnder(credentialId: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return (await sealedEntries()).some((entry) => sameBytes(entry.blob.credentialId, credentialId));
}

// The credential this browser saves everything behind. A new one is enrolled only when none is
// known, or the remembered one is gone and nothing is sealed under it; otherwise sealed keys would
// be orphaned.
async function credentialMaterial(): Promise<Opened> {
  const existing = knownCredentialId();
  if (existing !== null) {
    try {
      return { credentialId: existing, prfOutput: await unlockWithPasskey(existing) };
    } catch (error) {
      if (await hasSecretsUnder(existing)) throw error;
      forgetCredentialId();
    }
  }
  return enrollPasskey();
}

// When keys ended up under several passkeys, the worker re-seals them under one so the next reload
// asks once.
async function consolidate(post: Post, entries: SealedEntry[], opened: Opened[]): Promise<void> {
  if (opened.length <= 1) return;
  const known = knownCredentialId();
  const primary = opened.find((c) => known !== null && sameBytes(c.credentialId, known)) ?? opened[0]!;
  for (const { name, blob } of entries) {
    const source = opened.find((c) => sameBytes(c.credentialId, blob.credentialId));
    if (source === undefined || sameBytes(blob.credentialId, primary.credentialId)) continue;
    try {
      const salt = randomSalt();
      post({
        type: "passkey-reseal",
        name,
        from: await deriveAesKeyFromPrf(source.prfOutput, blob.salt),
        to: await deriveAesKeyFromPrf(primary.prfOutput, salt),
        credentialId: primary.credentialId,
        salt,
      });
    } catch {
      // Leave this one under its own passkey rather than risk losing it.
    }
  }
  rememberCredentialId(primary.credentialId);
}

/**
 * Saves `name` behind the device passkey. A cancelled or unsupported ceremony leaves the key
 * working for this tab instead of blocking the save.
 */
export async function seal(post: Post, name: string): Promise<boolean> {
  try {
    const { credentialId, prfOutput } = await credentialMaterial();
    rememberCredentialId(credentialId);
    const salt = randomSalt();
    const key = await deriveAesKeyFromPrf(prfOutput, salt);
    post({ type: "passkey-remember", name, key, credentialId, salt });
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens every sealed secret with one ceremony per distinct passkey. `answering` is the worker's own
 * unlock request, resolved first so a waiting run continues.
 */
export async function unlockAll(post: Post, answering?: UnlockRequest): Promise<boolean> {
  const entries = await sealedEntries();
  const credentials = distinctCredentials(entries);
  if (answering !== undefined) {
    credentials.sort((a, b) => Number(sameBytes(b, answering.credentialId)) - Number(sameBytes(a, answering.credentialId)));
  }
  const opened: Opened[] = [];
  let answered = false;
  for (const credentialId of credentials) {
    let prfOutput: BufferSource;
    try {
      prfOutput = await unlockWithPasskey(credentialId);
    } catch {
      continue;
    }
    opened.push({ credentialId, prfOutput });
    for (const { name, blob } of entries) {
      if (!sameBytes(blob.credentialId, credentialId)) continue;
      const key = await deriveAesKeyFromPrf(prfOutput, blob.salt);
      if (answering !== undefined && answering.name === name && !answered) {
        post({ type: "passkey-unlock-response", id: answering.id, key });
        answered = true;
      } else {
        post({ type: "unlock-secret", name, key });
      }
    }
  }
  if (answering !== undefined && !answered) post({ type: "passkey-unlock-response", id: answering.id, key: null });
  await consolidate(post, entries, opened);
  return opened.length > 0;
}
