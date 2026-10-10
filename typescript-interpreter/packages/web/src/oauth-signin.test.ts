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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearLegacyRefreshTokens, createOAuthSignIns, relayOAuthCallbackIfPopup } from "./oauth-signin";
import type { ClientMessage } from "./protocol";

describe("clearLegacyRefreshTokens", () => {
  function fakeLocalStorage(initial: Record<string, string>) {
    const map = new Map(Object.entries(initial));
    return {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      _map: map,
    };
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes refresh tokens left behind by earlier versions", () => {
    const ls = fakeLocalStorage({
      "afm.wso2.refresh": "rt-wso2",
      "afm.oauth.githubabc123.refresh": "rt-agent",
    });
    vi.stubGlobal("localStorage", ls);

    clearLegacyRefreshTokens();

    expect(ls._map.has("afm.wso2.refresh")).toBe(false);
    expect(ls._map.has("afm.oauth.githubabc123.refresh")).toBe(false);
  });

  it("leaves unrelated app data alone", () => {
    const ls = fakeLocalStorage({
      "afm.wso2.refresh": "rt",
      "afm.agents": "[]",
      "afm.theme": "dark",
      "afm.history": "[]",
    });
    vi.stubGlobal("localStorage", ls);

    clearLegacyRefreshTokens();

    expect(ls._map.has("afm.wso2.refresh")).toBe(false);
    expect(ls._map.get("afm.agents")).toBe("[]");
    expect(ls._map.get("afm.theme")).toBe("dark");
    expect(ls._map.get("afm.history")).toBe("[]");
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => clearLegacyRefreshTokens()).not.toThrow();
  });
});

const ORIGIN = "https://app.example.com";

function fakePopup() {
  return { closed: false, close: vi.fn(function (this: { closed: boolean }) { this.closed = true; }), location: { href: "" } };
}

function fakeWindow(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const intervals: (() => void)[] = [];
  return {
    listeners,
    intervals,
    location: { origin: ORIGIN, search: "" },
    name: "",
    open: vi.fn(),
    setInterval: (callback: () => void) => intervals.push(callback),
    clearInterval: () => {},
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)),
    message(event: unknown) {
      for (const listener of listeners.get("message") ?? []) listener(event);
    },
    ...extra,
  };
}

describe("relayOAuthCallbackIfPopup", () => {
  beforeEach(() => vi.unstubAllGlobals());

  function popupWindow(search: string) {
    const opener = { postMessage: vi.fn() };
    const win = fakeWindow({ name: "afm-oauth-signin", opener, close: vi.fn(), location: { origin: ORIGIN, search } }) as ReturnType<
      typeof fakeWindow
    > & { close: ReturnType<typeof vi.fn> };
    vi.stubGlobal("window", win);
    return { win, opener };
  }

  it("hands the code to the opener and closes", () => {
    const { win, opener } = popupWindow("?code=abc&state=xyz");
    expect(relayOAuthCallbackIfPopup()).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith({ type: "afm-oauth-callback", code: "abc", state: "xyz" }, ORIGIN);
    expect(win.close).toHaveBeenCalled();
  });

  it("passes the issuer along when the answer names one", () => {
    const { opener } = popupWindow("?code=abc&state=xyz&iss=https%3A%2F%2Fauth.example.com");
    expect(relayOAuthCallbackIfPopup()).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "afm-oauth-callback", code: "abc", state: "xyz", iss: "https://auth.example.com" },
      ORIGIN,
    );
  });

  it("leaves the issuer out when the answer has none", () => {
    const { opener } = popupWindow("?code=abc&state=xyz");
    relayOAuthCallbackIfPopup();
    expect(opener.postMessage.mock.calls[0]?.[0]).not.toHaveProperty("iss");
  });

  it("hands a refusal to the opener too, instead of opening the whole app in the popup", () => {
    const { win, opener } = popupWindow("?error=access_denied&state=xyz");
    expect(relayOAuthCallbackIfPopup()).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith({ type: "afm-oauth-callback", error: "access_denied" }, ORIGIN);
    expect(win.close).toHaveBeenCalled();
  });

  it("leaves an ordinary page load alone", () => {
    vi.stubGlobal("window", fakeWindow({ name: "", location: { origin: ORIGIN, search: "?code=abc&state=xyz" } }));
    expect(relayOAuthCallbackIfPopup()).toBe(false);
  });

  it("leaves the popup alone when it landed here without a code or a refusal", () => {
    popupWindow("");
    expect(relayOAuthCallbackIfPopup()).toBe(false);
  });
});

describe("createOAuthSignIns", () => {
  const provider = { authorizeUrl: "https://auth.example.com/authorize", tokenUrl: "https://auth.example.com/token", clientId: "c" };

  function setup() {
    const popup = fakePopup();
    const win = fakeWindow();
    win.open.mockReturnValue(popup);
    vi.stubGlobal("window", win);
    const posted: ClientMessage[] = [];
    const deps = { post: (message: ClientMessage) => void posted.push(message), onPopupBlocked: vi.fn(), onFailure: vi.fn() };
    const signIns = createOAuthSignIns(deps);
    const result = signIns.start(provider, false);
    const startId = (posted[0] as { id: string }).id;
    return { popup, win, posted, deps, signIns, result, startId };
  }

  beforeEach(() => vi.unstubAllGlobals());

  it("sends the popup to the address the worker built, and relays the code back", async () => {
    const { popup, win, posted, signIns, result, startId } = setup();
    signIns.onAuthorizeUrl(startId, "https://auth.example.com/authorize?state=s");
    expect(popup.location.href).toBe("https://auth.example.com/authorize?state=s");

    win.message({ origin: ORIGIN, source: popup, data: { type: "afm-oauth-callback", code: "abc", state: "s" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.at(-1)).toEqual({ type: "oauth-signin-code", id: startId, code: "abc", state: "s" });

    signIns.onDone(startId, true);
    expect(await result).toBe(true);
  });

  it("relays the issuer to the worker when the popup reports one", async () => {
    const { popup, win, posted, startId } = setup();
    win.message({ origin: ORIGIN, source: popup, data: { type: "afm-oauth-callback", code: "abc", state: "s", iss: "https://auth.example.com" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.at(-1)).toEqual({ type: "oauth-signin-code", id: startId, code: "abc", state: "s", iss: "https://auth.example.com" });
  });

  it("leaves out an issuer that is not a string", async () => {
    const { popup, win, posted } = setup();
    win.message({ origin: ORIGIN, source: popup, data: { type: "afm-oauth-callback", code: "abc", state: "s", iss: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.at(-1)).not.toHaveProperty("iss");
  });

  it("closes the popup and says so when the provider refuses", async () => {
    const { popup, win, posted, deps, result } = setup();
    win.message({ origin: ORIGIN, source: popup, data: { type: "afm-oauth-callback", error: "access_denied" } });
    expect(await result).toBe(false);
    expect(popup.close).toHaveBeenCalled();
    expect(deps.onFailure).toHaveBeenCalledWith(expect.stringContaining("access_denied"));
    expect(posted.some((message) => message.type === "oauth-signin-code")).toBe(false);
  });

  it("tells the user why the worker could not finish the sign-in", async () => {
    const { deps, signIns, result, startId } = setup();
    signIns.onDone(startId, false, "OAuth2 sign-in state mismatch");
    expect(await result).toBe(false);
    expect(deps.onFailure).toHaveBeenCalledWith("Sign-in failed: OAuth2 sign-in state mismatch");
  });

  it("treats a popup the user closed as a quiet cancel", async () => {
    const { popup, win, deps, result } = setup();
    popup.closed = true;
    for (const tick of win.intervals) tick();
    expect(await result).toBe(false);
    expect(deps.onFailure).not.toHaveBeenCalled();
  });

  it("ignores a message that did not come from the popup", async () => {
    const { popup, win, posted, signIns, result, startId } = setup();
    win.message({ origin: "https://evil.example", source: popup, data: { type: "afm-oauth-callback", code: "x", state: "y" } });
    win.message({ origin: ORIGIN, source: {}, data: { type: "afm-oauth-callback", code: "x", state: "y" } });
    expect(posted.filter((message) => message.type === "oauth-signin-code")).toHaveLength(0);
    signIns.onDone(startId, false);
    expect(await result).toBe(false);
  });
});
