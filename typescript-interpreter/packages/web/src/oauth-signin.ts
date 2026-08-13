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

import { authorizationCodeRefreshKey, type OAuthProviderRef } from "@afm/adapter-auth";
import type { ClientMessage } from "./protocol";
import { seal } from "./passkey/vault";

export type PopupResult = { code: string; state: string; iss?: string } | { error: string };

// The redirect lands on the app's own root, so this window name is how that load knows to relay
// instead of render.
const POPUP_NAME = "afm-oauth-signin";

// Must be called straight from the click, before any await, or the browser blocks the window.
function openSignInPopup(): Window | null {
  return window.open("about:blank", POPUP_NAME, "width=520,height=680");
}

// At startup: if this window is the sign-in popup returning with a result, hand it to the opener
// and close. Returns true when it did, so the app is not mounted here.
export function relayOAuthCallbackIfPopup(): boolean {
  if (window.name !== POPUP_NAME) return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const iss = params.get("iss");
  const error = params.get("error");
  if (error === null && (code === null || state === null)) return false;
  const result = error !== null ? { error } : { code, state, ...(iss === null ? {} : { iss }) };
  window.opener?.postMessage({ type: "afm-oauth-callback", ...result }, window.location.origin);
  window.close();
  return true;
}

// Resolves with the callback page's message: the one-time code, or the provider's refusal. Only our
// origin, this popup and the expected shape are accepted, and listening stops after the first.
function awaitPopupResult(popup: Window): Promise<PopupResult> {
  return new Promise((resolve, reject) => {
    const poll = window.setInterval(() => {
      if (popup.closed) settle(() => reject(new Error("Sign-in was cancelled.")));
    }, 400);

    function settle(done: () => void): void {
      window.clearInterval(poll);
      window.removeEventListener("message", onMessage);
      done();
    }

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      const data = event.data as { type?: unknown; code?: unknown; state?: unknown; iss?: unknown; error?: unknown };
      if (data?.type !== "afm-oauth-callback") return;
      if (typeof data.error === "string") {
        settle(() => resolve({ error: data.error as string }));
      } else if (typeof data.code === "string" && typeof data.state === "string") {
        const iss = typeof data.iss === "string" ? { iss: data.iss } : {};
        settle(() => resolve({ code: data.code as string, state: data.state as string, ...iss }));
      }
    }

    window.addEventListener("message", onMessage);
  });
}

const LEGACY_REFRESH_KEY = /^afm\.(wso2\.refresh|oauth\..+\.refresh)$/;

// Removes refresh tokens an earlier version left in localStorage. The pattern also covers
// 'afm.wso2.refresh', the token of a sign-in that no longer exists.
export function clearLegacyRefreshTokens(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && LEGACY_REFRESH_KEY.test(key)) {
        stale.push(key);
      }
    }
    for (const key of stale) {
      localStorage.removeItem(key);
    }
  } catch {
    return;
  }
}

interface Flow {
  popup: Window;
  provider: OAuthProviderRef;
  remember: boolean;
  resolve: (ok: boolean) => void;
}

export interface OAuthSignInDeps {
  post: (message: ClientMessage) => void;
  onPopupBlocked: () => void;
  onSettled: () => void;
  // Says why a flow failed. Closing the popup is the user's own choice and is not reported.
  onFailure: (reason: string) => void;
}

export interface OAuthSignIns {
  start(provider: OAuthProviderRef, remember: boolean): Promise<boolean>;
  onAuthorizeUrl(id: string, url: string): void;
  onDone(id: string, ok: boolean, error?: string): void;
}

/**
 * Drives an interactive OAuth sign-in through a popup while the worker owns the exchange and
 * tokens. This side opens the popup on the click, points it at the worker's authorize URL and
 * relays the one-time code; it never sees a token.
 */
export function createOAuthSignIns(deps: OAuthSignInDeps): OAuthSignIns {
  const flows = new Map<string, Flow>();

  return {
    start(provider, remember) {
      const popup = openSignInPopup();
      if (popup === null) {
        deps.onPopupBlocked();
        return Promise.resolve(false);
      }
      const id = crypto.randomUUID();
      return new Promise<boolean>((resolve) => {
        flows.set(id, { popup, provider, remember, resolve });
        deps.post({ type: "oauth-signin-start", id, provider });

        const abandon = (reason?: string): void => {
          flows.delete(id);
          if (!popup.closed) popup.close();
          deps.onSettled();
          if (reason !== undefined) deps.onFailure(reason);
          resolve(false);
        };

        awaitPopupResult(popup).then(
          (result) => {
            if ("error" in result) abandon(`Sign-in was declined (${result.error.slice(0, 80)}).`);
            else deps.post({ type: "oauth-signin-code", id, ...result });
          },
          () => abandon(),
        );
      });
    },

    onAuthorizeUrl(id, url) {
      const flow = flows.get(id);
      if (flow !== undefined && !flow.popup.closed) flow.popup.location.href = url;
    },

    onDone(id, ok, error) {
      const flow = flows.get(id);
      flows.delete(id);
      if (flow === undefined) return;
      if (!flow.popup.closed) flow.popup.close();
      deps.onSettled();
      if (!ok && error !== undefined) deps.onFailure(`Sign-in failed: ${error}`);
      if (ok && flow.remember) void seal(deps.post, authorizationCodeRefreshKey(flow.provider));
      flow.resolve(ok);
    },
  };
}
