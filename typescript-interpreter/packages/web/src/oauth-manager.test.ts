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
import { createOAuthManager, type OAuthManagerDeps } from "./oauth-manager";
import { authorizationCodeRefreshKey, type KeyValueStore, type OAuthProviderRef } from "@afm/adapter-auth";
import type { StoredSecret } from "./passkey/store";

const sealedDisk = new Map<string, StoredSecret>();

vi.mock("./passkey/store", () => ({
  saveBlob: async (name: string, blob: StoredSecret) => void sealedDisk.set(name, blob),
  loadBlob: async (name: string) => sealedDisk.get(name) ?? null,
  removeBlob: async (name: string) => void sealedDisk.delete(name),
  listNames: async () => [...sealedDisk.keys()],
}));

const { createWorkerSecretStore } = await import("./worker-secret-store");

const provider: OAuthProviderRef = {
  authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  clientId: "client-1",
};

function memoryStore(): KeyValueStore {
  const entries = new Map<string, string>();
  return { get: (key) => entries.get(key) ?? null, set: (key, value) => void entries.set(key, value), remove: (key) => void entries.delete(key) };
}

function tokenFetch(body: Record<string, unknown>): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

function makeManager(overrides: Partial<OAuthManagerDeps> = {}) {
  const emitted: { url?: { id: string; url: string }; result?: { id: string; ok: boolean; error?: string } } = {};
  const refreshStore = overrides.refreshStore ?? memoryStore();
  const manager = createOAuthManager({
    fetchFn: tokenFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    redirectUri: "https://app.example.com/",
    refreshStore,
    loadSealedRefresh: async () => {},
    emitAuthorizeUrl: (id, url) => (emitted.url = { id, url }),
    emitSignInResult: (id, ok, error) => (emitted.result = { id, ok, error }),
    ...overrides,
  });
  return { manager, emitted, refreshStore };
}

async function signIn(manager: ReturnType<typeof makeManager>["manager"], emitted: ReturnType<typeof makeManager>["emitted"], id: string): Promise<void> {
  await manager.startSignIn(id, provider);
  const state = new URL(emitted.url!.url).searchParams.get("state")!;
  await manager.completeSignIn(id, "the-code", state);
}

describe("createOAuthManager", () => {
  it("asks for sign-in and throws when there is no session", async () => {
    const { manager } = makeManager();
    let asked = false;
    await expect(manager.getAccessToken(provider, () => (asked = true))).rejects.toThrow(/sign-in/i);
    expect(asked).toBe(true);
  });

  it("signs in, then serves the access token without asking again", async () => {
    const { manager, emitted } = makeManager();
    await signIn(manager, emitted, "id-1");
    expect(emitted.result).toEqual({ id: "id-1", ok: true, error: undefined });
    let asked = false;
    expect(await manager.getAccessToken(provider, () => (asked = true))).toBe("at");
    expect(asked).toBe(false);
  });

  it("stores the refresh token in refreshStore after sign-in", async () => {
    const { manager, emitted, refreshStore } = makeManager();
    await signIn(manager, emitted, "id-2");
    expect(refreshStore.get(authorizationCodeRefreshKey(provider))).toBe("rt");
  });

  it("restores from a remembered refresh token, no sign-in needed", async () => {
    const refreshStore = memoryStore();
    const { manager } = makeManager({
      refreshStore,
      loadSealedRefresh: async (key) => refreshStore.set(key, "saved-refresh"),
    });
    let asked = false;
    expect(await manager.getAccessToken(provider, () => (asked = true))).toBe("at");
    expect(asked).toBe(false);
  });

  it("reports a state mismatch as a failed sign-in rather than throwing", async () => {
    const { manager, emitted } = makeManager();
    await manager.startSignIn("id-3", provider);
    await manager.completeSignIn("id-3", "the-code", "wrong-state");
    expect(emitted.result?.ok).toBe(false);
    expect(emitted.result?.error).toMatch(/state mismatch/i);
  });

  it("reports an answer from a different server as a failed sign-in, without exchanging the code", async () => {
    const requested: string[] = [];
    const otherServer = {
      issuer: "https://other.example.com",
      authorization_endpoint: "https://other.example.com/authorize",
      token_endpoint: "https://other.example.com/token",
      code_challenge_methods_supported: ["S256"],
    };
    const fetchFn = (async (url: string) => {
      requested.push(String(url));
      return { ok: true, status: 200, json: async () => otherServer };
    }) as unknown as typeof fetch;
    const { manager, emitted } = makeManager({ fetchFn });
    await manager.startSignIn("id-5", provider);
    const state = new URL(emitted.url!.url).searchParams.get("state")!;

    await manager.completeSignIn("id-5", "the-code", state, "https://other.example.com");

    expect(emitted.result).toMatchObject({ id: "id-5", ok: false });
    expect(emitted.result?.error).toMatch(/different server/);
    expect(requested).not.toContain(provider.tokenUrl);
  });

  it("reports a sign-in that cannot start, rather than leaving the popup waiting", async () => {
    const { manager, emitted } = makeManager();
    await manager.startSignIn("id-x", { ...provider, authorizeUrl: "http://auth.example.com/authorize" });
    expect(emitted.url).toBeUndefined();
    expect(emitted.result).toMatchObject({ id: "id-x", ok: false });
    expect(emitted.result?.error).toMatch(/https/);
  });

  it("reports a code for an unknown sign-in as failed", async () => {
    const { manager, emitted } = makeManager();
    await manager.completeSignIn("never-started", "code", "state");
    expect(emitted.result?.ok).toBe(false);
  });

  it("signOut drops the session so the next call asks to sign in again", async () => {
    const { manager, emitted } = makeManager();
    await signIn(manager, emitted, "id-4");
    manager.signOut(provider);
    await expect(manager.getAccessToken(provider, () => {})).rejects.toThrow(/sign-in/i);
  });
});

describe("a remembered sign-in kept fresh through the real worker secret store", () => {
  function rotatingServer() {
    let n = 0;
    const valid = new Set<string>();
    let revoked = false;
    return (async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body));
      if (body.get("grant_type") === "authorization_code") {
        const token = `R${n++}`;
        valid.add(token);
        return Response.json({ access_token: "at", refresh_token: token, expires_in: 0 });
      }
      const refreshToken = body.get("refresh_token")!;
      if (revoked || !valid.has(refreshToken)) {
        revoked = true;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      valid.delete(refreshToken);
      const next = `R${n++}`;
      valid.add(next);
      return Response.json({ access_token: "at", refresh_token: next, expires_in: 0 });
    }) as typeof fetch;
  }

  function tab(fetchFn: typeof fetch, key: CryptoKey) {
    const store = createWorkerSecretStore((message) => {
      if (message.type === "passkey-unlock-request") queueMicrotask(() => store.resolveUnlock(message.id, key));
    });
    let authorizeUrl = "";
    const manager = createOAuthManager({
      fetchFn,
      redirectUri: "https://afm.example/",
      refreshStore: store.refreshStore,
      loadSealedRefresh: (refreshKey) => store.loadSealedRefresh(refreshKey),
      emitAuthorizeUrl: (_id, url) => (authorizeUrl = url),
      emitSignInResult: () => {},
    });
    return { store, manager, state: () => new URL(authorizeUrl).searchParams.get("state")! };
  }

  it("restores a rotated refresh token after a reload, with no sign-in needed", async () => {
    const fetchFn = rotatingServer();
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const first = tab(fetchFn, key);
    await first.manager.startSignIn("s1", provider);
    await first.manager.completeSignIn("s1", "code", first.state());
    first.store.seal(authorizationCodeRefreshKey(provider), key, new Uint8Array([1]), new Uint8Array([2]));
    await vi.waitFor(() => expect(sealedDisk.has(authorizationCodeRefreshKey(provider))).toBe(true));

    await first.manager.getAccessToken(provider, () => {});
    await first.manager.getAccessToken(provider, () => {});

    const second = tab(fetchFn, key);
    let needed = false;
    await second.manager.getAccessToken(provider, () => (needed = true)).catch(() => {});
    expect(needed).toBe(false);
  });

  it("keeps the blob after the shared 401 path, but the explicit Sign out clears it", async () => {
    const fetchFn = rotatingServer();
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const first = tab(fetchFn, key);
    await first.manager.startSignIn("s1", provider);
    await first.manager.completeSignIn("s1", "code", first.state());
    first.store.seal(authorizationCodeRefreshKey(provider), key, new Uint8Array([1]), new Uint8Array([2]));
    await vi.waitFor(() => expect(sealedDisk.has(authorizationCodeRefreshKey(provider))).toBe(true));

    first.manager.signOut(provider);
    expect(await first.store.isSaved(authorizationCodeRefreshKey(provider))).toBe(true);

    // What worker.ts's "oauth-sign-out" case does in addition to the shared signOut.
    first.store.forgetSealed(authorizationCodeRefreshKey(provider));
    await vi.waitFor(async () => expect(await first.store.isSaved(authorizationCodeRefreshKey(provider))).toBe(false));

    const second = tab(fetchFn, key);
    let needed = false;
    await second.manager.getAccessToken(provider, () => (needed = true)).catch(() => {});
    expect(needed).toBe(true);
  });
});

