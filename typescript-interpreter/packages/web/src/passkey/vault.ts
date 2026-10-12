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
import { deriveAesKey, importPrf, randomSalt } from "./crypto";
import { loadBlob, listNames, type StoredSecret } from "./store";
import { enrollPasskey } from "./enroll";
import { unlockWithPasskey } from "./unlock";
import { knownCredentialId, rememberCredentialId, forgetCredentialId } from "./credential";


type Post = (message: ClientMessage) => void;

interface SealedEntry {
  name: string;
  blob: StoredSecret;
}

interface Opened {
  credentialId: Uint8Array<ArrayBuffer>;
  prf: CryptoKey;
}

let opened: Opened | null = null;

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

async function ceremony(credentialId: Uint8Array<ArrayBuffer>): Promise<Opened> {
  if (opened !== null && sameBytes(opened.credentialId, credentialId)) return opened;
  return { credentialId, prf: await importPrf(await unlockWithPasskey(credentialId)) };
}

async function credentialMaterial(): Promise<Opened> {
  if (opened !== null) return opened;
  const existing = knownCredentialId();
  if (existing !== null) {
    try {
      return (opened = await ceremony(existing));
    } catch (error) {
      if (await hasSecretsUnder(existing)) throw error;
      forgetCredentialId();
    }
  }
  const enrolled = await enrollPasskey();
  return (opened = { credentialId: enrolled.credentialId, prf: await importPrf(enrolled.prfOutput) });
}

function primaryOf(all: Opened[]): Opened | undefined {
  const known = knownCredentialId();
  return all.find((credential) => known !== null && sameBytes(credential.credentialId, known)) ?? all[0];
}

async function consolidate(post: Post, entries: SealedEntry[], all: Opened[]): Promise<void> {
  const primary = primaryOf(all);
  if (primary === undefined) return;
  opened = primary;
  if (all.length <= 1) return;
  for (const { name, blob } of entries) {
    const source = all.find((credential) => sameBytes(credential.credentialId, blob.credentialId));
    if (source === undefined || sameBytes(blob.credentialId, primary.credentialId)) continue;
    try {
      const salt = randomSalt();
      post({
        type: "passkey-reseal",
        name,
        from: await deriveAesKey(source.prf, blob.salt),
        to: await deriveAesKey(primary.prf, salt),
        credentialId: primary.credentialId,
        salt,
      });
    } catch {
    }
  }
  rememberCredentialId(primary.credentialId);
}

export async function seal(post: Post, name: string): Promise<boolean> {
  try {
    const { credentialId, prf } = await credentialMaterial();
    rememberCredentialId(credentialId);
    const salt = randomSalt();
    post({ type: "passkey-remember", name, key: await deriveAesKey(prf, salt), credentialId, salt });
    return true;
  } catch {
    return false;
  }
}

export async function unlockAll(post: Post): Promise<boolean> {
  const entries = await sealedEntries();
  const all: Opened[] = [];
  for (const credentialId of distinctCredentials(entries)) {
    let credential: Opened;
    try {
      credential = await ceremony(credentialId);
    } catch {
      continue;
    }
    all.push(credential);
    for (const { name, blob } of entries) {
      if (sameBytes(blob.credentialId, credentialId)) post({ type: "unlock-secret", name, key: await deriveAesKey(credential.prf, blob.salt) });
    }
  }
  await consolidate(post, entries, all);
  return all.length > 0;
}
