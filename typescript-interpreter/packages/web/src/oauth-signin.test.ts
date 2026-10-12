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
import { clearLegacyRefreshTokens, createOAuthSignIns, relayOAuthCallback } from "./oauth-signin";
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

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  posted: unknown[] = [];
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  close() {
    this.closed = true;
  }
  static deliver(data: unknown) {
    for (const channel of FakeChannel.all.filter((item) => !item.closed)) channel.onmessage?.({ data });
  }
}

function fakeWindow(extra: Record<string, unknown> = {}) {
  const timeouts: (() => void)[] = [];
  return {
    timeouts,
    location: { origin: ORIGIN, search: "" },
    name: "",
    open: vi.fn(),
    setTimeout: (callback: () => void) => timeouts.push(callback),
    clearTimeout: () => {},
    close: vi.fn(),
    ...extra,
  };
}

describe("relayOAuthCallback", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    FakeChannel.all = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });

  function callbackPage(search: string) {
    const win = fakeWindow({ location: { origin: ORIGIN, search } });
    const body = { textContent: "" };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { body });
    return { win, body };
  }

  it("hands the code to whoever started the sign-in, and closes", () => {
    const { win } = callbackPage("?code=abc&state=xyz");
    expect(relayOAuthCallback()).toBe(true);
    expect(FakeChannel.all[0]?.name).toBe("afm-oauth-callback");
    expect(FakeChannel.all[0]?.posted).toEqual([{ code: "abc", state: "xyz" }]);
    expect(win.close).toHaveBeenCalled();
  });

  it("passes the issuer along when the answer names one", () => {
    callbackPage("?code=abc&state=xyz&iss=https%3A%2F%2Fauth.example.com");
    expect(relayOAuthCallback()).toBe(true);
    expect(FakeChannel.all[0]?.posted).toEqual([{ code: "abc", state: "xyz", iss: "https://auth.example.com" }]);
  });

  it("leaves the issuer out when the answer has none", () => {
    callbackPage("?code=abc&state=xyz");
    relayOAuthCallback();
    expect(FakeChannel.all[0]?.posted[0]).not.toHaveProperty("iss");
  });

  it("hands a refusal over too, instead of opening the whole app in the popup", () => {
    const { win } = callbackPage("?error=access_denied&state=xyz");
    expect(relayOAuthCallback()).toBe(true);
    expect(FakeChannel.all[0]?.posted).toEqual([{ error: "access_denied", state: "xyz" }]);
    expect(win.close).toHaveBeenCalled();
  });

  it("says the window can be closed when the browser will not close it", () => {
    const { body } = callbackPage("?code=abc&state=xyz");
    relayOAuthCallback();
    expect(body.textContent).toBe("You can close this window.");
  });

  it("works with no opener and no window name, which is what a provider that isolates its pages leaves", () => {
    callbackPage("?code=abc&state=xyz");
    expect(window.name).toBe("");
    expect(relayOAuthCallback()).toBe(true);
  });

  it("leaves an ordinary page load alone", () => {
    callbackPage("");
    expect(relayOAuthCallback()).toBe(false);
    expect(FakeChannel.all).toHaveLength(0);
  });

  it("leaves a page alone when the answer carries no state", () => {
    callbackPage("?code=abc");
    expect(relayOAuthCallback()).toBe(false);
  });
});

describe("createOAuthSignIns", () => {
  const provider = { authorizeUrl: "https://auth.example.com/authorize", tokenUrl: "https://auth.example.com/token", clientId: "c" };
  const AUTHORIZE = "https://auth.example.com/authorize?state=s";

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
    signIns.onAuthorizeUrl(startId, AUTHORIZE);
    return { popup, win, posted, deps, signIns, result, startId };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.unstubAllGlobals();
    FakeChannel.all = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });

  it("sends the popup to the address the worker built, and relays the code back", async () => {
    const { popup, posted, signIns, result, startId } = setup();
    expect(popup.location.href).toBe(AUTHORIZE);

    FakeChannel.deliver({ code: "abc", state: "s" });
    await settle();
    expect(posted.at(-1)).toEqual({ type: "oauth-signin-code", id: startId, code: "abc", state: "s" });

    signIns.onDone(startId, true);
    expect(await result).toBe(true);
  });

  it("still hears the answer when the provider has cut the popup loose and it reads as closed", async () => {
    const { popup, posted, signIns, result, startId } = setup();
    popup.closed = true;
    FakeChannel.deliver({ code: "abc", state: "s" });
    await settle();
    expect(posted.at(-1)).toEqual({ type: "oauth-signin-code", id: startId, code: "abc", state: "s" });
    signIns.onDone(startId, true);
    expect(await result).toBe(true);
  });

  it("relays the issuer to the worker when the callback reports one", async () => {
    const { posted, startId } = setup();
    FakeChannel.deliver({ code: "abc", state: "s", iss: "https://auth.example.com" });
    await settle();
    expect(posted.at(-1)).toEqual({ type: "oauth-signin-code", id: startId, code: "abc", state: "s", iss: "https://auth.example.com" });
  });

  it("leaves out an issuer that is not a string", async () => {
    const { posted } = setup();
    FakeChannel.deliver({ code: "abc", state: "s", iss: 5 });
    await settle();
    expect(posted.at(-1)).not.toHaveProperty("iss");
  });

  it("closes the popup and says so when the provider refuses", async () => {
    const { popup, posted, deps, result } = setup();
    FakeChannel.deliver({ error: "access_denied", state: "s" });
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

  it("gives up quietly when no answer ever comes", async () => {
    const { win, deps, result } = setup();
    for (const timeout of win.timeouts) timeout();
    expect(await result).toBe(false);
    expect(deps.onFailure).not.toHaveBeenCalled();
  });

  it("ignores an answer that belongs to a different sign-in", async () => {
    const { posted, signIns, result, startId } = setup();
    FakeChannel.deliver({ code: "x", state: "someone-else" });
    FakeChannel.deliver({ code: "x" });
    FakeChannel.deliver("not an object");
    await settle();
    expect(posted.filter((message) => message.type === "oauth-signin-code")).toHaveLength(0);
    signIns.onDone(startId, false);
    expect(await result).toBe(false);
  });

  it("stops listening once the answer has arrived", async () => {
    setup();
    FakeChannel.deliver({ code: "abc", state: "s" });
    await settle();
    expect(FakeChannel.all.every((channel) => channel.closed)).toBe(true);
  });
});
