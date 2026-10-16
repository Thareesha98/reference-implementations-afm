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

import type { OAuthProviderRef } from "@afm/adapter-auth";
import type { ClientMessage, SignInVetting } from "./protocol";

export type PopupResult = { code: string; state: string; iss?: string } | { error: string; state: string; iss?: string };

export type SignInOutcome =
  | { status: "signed-in" }
  | { status: "failed"; reason?: string }
  | { status: "confirm"; host: string };

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
  const issuer = iss === null ? {} : { iss };
  const result = error !== null ? { error, state, ...issuer } : { code, state, ...issuer };
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
      const iss = typeof data.iss === "string" ? { iss: data.iss } : {};
      if (typeof data.error === "string") {
        settle(() => resolve({ error: data.error as string, state: data.state as string, ...iss }));
      } else if (typeof data.code === "string") {
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
  state?: string;
  resolve: (outcome: SignInOutcome) => void;
}

export interface OAuthSignInDeps {
  post: (message: ClientMessage) => void;
}

export interface OAuthSignIns {
  start(provider: OAuthProviderRef, vetting: SignInVetting): Promise<SignInOutcome>;
  onAuthorizeUrl(id: string, url: string): void;
  onConfirm(id: string, host: string): void;
  onDone(id: string, ok: boolean, error?: string): void;
}

export function createOAuthSignIns(deps: OAuthSignInDeps): OAuthSignIns {
  const flows = new Map<string, Flow>();

  return {
    start(provider, vetting) {
      const popup = openSignInPopup();
      if (popup === null) {
        return Promise.resolve<SignInOutcome>({ status: "failed", reason: "Allow pop-ups for this site to sign in." });
      }
      const id = crypto.randomUUID();
      return new Promise<SignInOutcome>((resolve) => {
        flows.set(id, { popup, provider, resolve });
        deps.post({ type: "oauth-signin-start", id, provider, ...vetting });

        awaitCallback(() => flows.get(id)?.state).then(
          (result) => deps.post("error" in result ? { type: "oauth-signin-error", id, ...result } : { type: "oauth-signin-code", id, ...result }),
          () => {
            flows.delete(id);
            if (!popup.closed) popup.close();
            resolve({ status: "failed" });
          },
        );
      });
    },

    onAuthorizeUrl(id, url) {
      const flow = flows.get(id);
      if (flow === undefined || flow.popup.closed) return;
      flow.state = new URL(url).searchParams.get("state") ?? undefined;
      flow.popup.location.href = url;
    },

    onConfirm(id, host) {
      const flow = flows.get(id);
      flows.delete(id);
      if (flow === undefined) return;
      if (!flow.popup.closed) flow.popup.close();
      flow.resolve({ status: "confirm", host });
    },

    onDone(id, ok, error) {
      const flow = flows.get(id);
      flows.delete(id);
      if (flow === undefined) return;
      if (!flow.popup.closed) flow.popup.close();
      flow.resolve(ok ? { status: "signed-in" } : { status: "failed", reason: error === undefined ? undefined : `Sign-in failed: ${error}` });
    },
  };
}
