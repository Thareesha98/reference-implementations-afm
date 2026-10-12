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

export type PopupResult = { code: string; state: string; iss?: string } | { error: string; state: string };

const POPUP_NAME = "afm-oauth-signin";
const CALLBACK_CHANNEL = "afm-oauth-callback";
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

// Must be called straight from the click, before any await, or the browser blocks the window.
function openSignInPopup(): Window | null {
  return window.open("about:blank", POPUP_NAME, "width=520,height=680");
}

export function relayOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const iss = params.get("iss");
  const error = params.get("error");
  if (state === null || (code === null && error === null)) return false;
  const result = error !== null ? { error, state } : { code, state, ...(iss === null ? {} : { iss }) };
  const channel = new BroadcastChannel(CALLBACK_CHANNEL);
  channel.postMessage(result);
  channel.close();
  document.body.textContent = "You can close this window.";
  window.close();
  return true;
}

function awaitCallback(stateOf: () => string | undefined): Promise<PopupResult> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CALLBACK_CHANNEL);
    const timer = window.setTimeout(() => settle(() => reject(new Error("Sign-in timed out."))), SIGN_IN_TIMEOUT_MS);

    function settle(done: () => void): void {
      window.clearTimeout(timer);
      channel.close();
      done();
    }

    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { code?: unknown; state?: unknown; iss?: unknown; error?: unknown };
      if (typeof data?.state !== "string" || data.state !== stateOf()) return;
      if (typeof data.error === "string") {
        settle(() => resolve({ error: data.error as string, state: data.state as string }));
      } else if (typeof data.code === "string") {
        const iss = typeof data.iss === "string" ? { iss: data.iss } : {};
        settle(() => resolve({ code: data.code as string, state: data.state as string, ...iss }));
      }
    };
  });
}

const LEGACY_REFRESH_KEY = /^afm\.(wso2\.refresh|oauth\..+\.refresh)$/;

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
  state?: string;
  resolve: (ok: boolean) => void;
}

export interface OAuthSignInDeps {
  post: (message: ClientMessage) => void;
  onPopupBlocked: () => void;
  onFailure: (reason: string) => void;
}

export interface OAuthSignIns {
  start(provider: OAuthProviderRef, remember: boolean): Promise<boolean>;
  onAuthorizeUrl(id: string, url: string): void;
  onDone(id: string, ok: boolean, error?: string): void;
}

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
          if (reason !== undefined) deps.onFailure(reason);
          resolve(false);
        };

        awaitCallback(() => flows.get(id)?.state).then(
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
      if (flow === undefined || flow.popup.closed) return;
      flow.state = new URL(url).searchParams.get("state") ?? undefined;
      flow.popup.location.href = url;
    },

    onDone(id, ok, error) {
      const flow = flows.get(id);
      flows.delete(id);
      if (flow === undefined) return;
      if (!flow.popup.closed) flow.popup.close();
      if (!ok && error !== undefined) deps.onFailure(`Sign-in failed: ${error}`);
      if (ok && flow.remember) void seal(deps.post, authorizationCodeRefreshKey(flow.provider));
      flow.resolve(ok);
    },
  };
}
