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

import {
  authorizationCodeProviderKey,
  authorizationCodeRefreshKey,
  createAuthorizationCodeSession,
  type AuthorizationCodeSession,
  type KeyValueStore,
  type OAuthProviderRef,
} from "@afm/adapter-auth";

export interface OAuthManagerDeps {
  fetchFn: typeof fetch;
  // Where the popup lands back with the code: the one URI registered with the provider.
  redirectUri: string;
  // Backs the refresh token, so a sealed copy and a fresh sign-in reach the session the same way.
  refreshStore: KeyValueStore;
  // Puts a remembered refresh token back into refreshStore, unlocking it if sealed.
  loadSealedRefresh: (refreshKey: string) => Promise<void>;
  emitAuthorizeUrl: (id: string, url: string) => void;
  emitSignInResult: (id: string, ok: boolean, error?: string) => void;
}

export interface OAuthManager {
  getAccessToken(provider: OAuthProviderRef, onSignInNeeded: () => void): Promise<string>;
  startSignIn(id: string, provider: OAuthProviderRef): Promise<void>;
  completeSignIn(id: string, code: string, state: string, iss?: string): Promise<void>;
  signOut(provider: OAuthProviderRef): void;
}

// Owns the interactive OAuth sessions inside the worker: code exchange, tokens and refresh all
// happen here, so nothing sensitive is on the main thread, which only opens the popup and relays
// the code.
export function createOAuthManager(deps: OAuthManagerDeps): OAuthManager {
  const sessions = new Map<string, AuthorizationCodeSession>();
  const inFlight = new Map<string, OAuthProviderRef>();

  function sessionFor(provider: OAuthProviderRef): AuthorizationCodeSession {
    const key = authorizationCodeProviderKey(provider);
    let session = sessions.get(key);
    if (session === undefined) {
      session = createAuthorizationCodeSession({ ...provider, redirectUri: deps.redirectUri }, deps.refreshStore);
      sessions.set(key, session);
    }
    return session;
  }

  return {
    async getAccessToken(provider, onSignInNeeded) {
      const session = sessionFor(provider);
      if (!session.hasSession()) {
        await deps.loadSealedRefresh(authorizationCodeRefreshKey(provider));
        await session.restore(deps.fetchFn).catch(() => false);
      }
      const token = await session.getAccessToken(deps.fetchFn);
      if (token !== null) return token;
      onSignInNeeded();
      throw new Error("Interactive sign-in is required for this server.");
    },

    async startSignIn(id, provider) {
      inFlight.set(id, provider);
      try {
        await sessionFor(provider).startSignIn((url) => deps.emitAuthorizeUrl(id, url));
      } catch (error) {
        inFlight.delete(id);
        deps.emitSignInResult(id, false, error instanceof Error ? error.message : String(error));
      }
    },

    async completeSignIn(id, code, state, iss) {
      // The provider was captured at startSignIn; the code message carries only code, state and the
      // issuer, so whatever relays it cannot change the exchange endpoint.
      const provider = inFlight.get(id);
      inFlight.delete(id);
      if (provider === undefined) {
        deps.emitSignInResult(id, false, "This sign-in is no longer waiting.");
        return;
      }
      try {
        await sessionFor(provider).completeSignIn(code, state, deps.fetchFn, iss);
        deps.emitSignInResult(id, true);
      } catch (error) {
        deps.emitSignInResult(id, false, error instanceof Error ? error.message : String(error));
      }
    },

    signOut(provider) {
      sessionFor(provider).signOut();
    },
  };
}
