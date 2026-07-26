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
import { generatePkce, randomString, buildAuthorizeUrl, exchangeCodeForTokens, refreshAuthorizationCodeTokens, isExpired, authorizationCodeProviderKey, authorizationCodeRefreshKey, createAuthorizationCodeSession, isInteractiveOAuth, oauthProviderFrom, createOAuth2MachineClient, requireHttpsUrl } from "./oauth";
import type { AuthorizationCodeConfig, AuthorizationCodeTokens, KeyValueStore, OAuth2MachineConfig } from "./oauth";

const config: AuthorizationCodeConfig = {
  authorizeUrl: "https://auth.example.com/oauth2/authorize",
  tokenUrl: "https://auth.example.com/oauth2/token",
  clientId: "client-123",
  redirectUri: "http://localhost:5173/run",
  scopes: ["read", "write"],
};

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const urlSafe = /^[A-Za-z0-9_-]+$/;

describe("PKCE primitives", () => {
  it("verifier and challenge are URL-safe, and challenge = S256(verifier)", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(urlSafe);
    expect(challenge).toMatch(urlSafe);
    expect(challenge).toBe(await s256(verifier));
  });

  it("generates a different verifier each time", async () => {
    expect((await generatePkce()).verifier).not.toBe((await generatePkce()).verifier);
    expect(randomString()).not.toBe(randomString());
  });
});

describe("buildAuthorizeUrl", () => {
  it("sets the OAuth + PKCE query params, with no client_secret anywhere", () => {
    const url = new URL(buildAuthorizeUrl(config, { state: "st", codeChallenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://auth.example.com/oauth2/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("client-123");
    expect(q.get("redirect_uri")).toBe("http://localhost:5173/run");
    expect(q.get("scope")).toBe("read write");
    expect(q.get("state")).toBe("st");
    expect(q.get("code_challenge")).toBe("ch");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("secret");
  });

  it("omits the scope param when no scopes are declared", () => {
    const noScopes: AuthorizationCodeConfig = { ...config, scopes: undefined };
    const url = new URL(buildAuthorizeUrl(noScopes, { state: "s", codeChallenge: "c" }));
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("omits the resource param when there is no resource to bind to, as today", () => {
    const url = new URL(buildAuthorizeUrl(config, { state: "s", codeChallenge: "c" }));
    expect(url.searchParams.has("resource")).toBe(false);
  });

  it("includes the resource param (RFC 8707) when a resource is given", () => {
    const withResource: AuthorizationCodeConfig = { ...config, resource: "https://mcp.example.com/mcp" };
    const url = new URL(buildAuthorizeUrl(withResource, { state: "s", codeChallenge: "c" }));
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");
  });
});

function fakeFetch(json: unknown, ok = true) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ""), headers: { ...(init?.headers as Record<string, string>) } });
    return { ok, status: ok ? 200 : 400, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const redirectTo = {
  url: "",
  capture: (url: string) => void (redirectTo.url = url),
  state: () => new URL(redirectTo.url).searchParams.get("state")!,
};

describe("exchangeCodeForTokens", () => {
  it("POSTs the code + verifier and returns tokens", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const before = Date.now();
    const tokens = await exchangeCodeForTokens(config, "the-code", "the-verifier", fn);
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(calls[0]?.url).toBe(config.tokenUrl);
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[0]?.body).toContain("code=the-code");
    expect(calls[0]?.body).toContain("code_verifier=the-verifier");
    expect(calls[0]?.body).not.toContain("resource=");
  });

  it("includes the resource param in the token request when the config has one", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at", expires_in: 3600 });
    const withResource: AuthorizationCodeConfig = { ...config, resource: "https://mcp.example.com/mcp" };
    await exchangeCodeForTokens(withResource, "c", "v", fn);
    expect(new URLSearchParams(calls[0]?.body).get("resource")).toBe("https://mcp.example.com/mcp");
  });

  it("throws on a non-OK response", async () => {
    const { fn } = fakeFetch({}, false);
    await expect(exchangeCodeForTokens(config, "c", "v", fn)).rejects.toThrow(/token exchange failed/i);
  });

  it("sends 'accept: application/json' - required by real providers like GitHub, which otherwise reply form-encoded", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at", expires_in: 3600 });
    await exchangeCodeForTokens(config, "c", "v", fn);
    expect(calls[0]?.headers.accept).toBe("application/json");
  });
});

describe("refreshAuthorizationCodeTokens", () => {
  it("uses grant_type=refresh_token and keeps the old refresh token if not rotated", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at2", expires_in: 1800 });
    const tokens = await refreshAuthorizationCodeTokens(config, "old-refresh", fn);
    expect(tokens.accessToken).toBe("at2");
    expect(tokens.refreshToken).toBe("old-refresh");
    expect(calls[0]?.body).toContain("grant_type=refresh_token");
    expect(calls[0]?.body).toContain("refresh_token=old-refresh");
    expect(calls[0]?.headers.accept).toBe("application/json");
  });

  it("includes the resource param on refresh too, when the config has one", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at2", expires_in: 1800 });
    const withResource: AuthorizationCodeConfig = { ...config, resource: "https://mcp.example.com/mcp" };
    await refreshAuthorizationCodeTokens(withResource, "old-refresh", fn);
    expect(new URLSearchParams(calls[0]?.body).get("resource")).toBe("https://mcp.example.com/mcp");
  });
});

describe("isExpired", () => {
  it("is true at/after expiry (with skew) and false well before", () => {
    const soon: AuthorizationCodeTokens = { accessToken: "x", expiresAt: Date.now() + 10_000 };
    const later: AuthorizationCodeTokens = { accessToken: "x", expiresAt: Date.now() + 600_000 };
    expect(isExpired(soon)).toBe(true);
    expect(isExpired(later)).toBe(false);
  });
});

describe("authorizationCodeProviderKey", () => {
  it("is stable for the same provider config and storage-safe", () => {
    const key = authorizationCodeProviderKey(config);
    expect(key).toMatch(/^[a-zA-Z0-9]+$/);
    expect(authorizationCodeProviderKey({ ...config })).toBe(key);
  });

  it("differs for a different provider or client_id", () => {
    const key = authorizationCodeProviderKey(config);
    expect(authorizationCodeProviderKey({ ...config, clientId: "other-client" })).not.toBe(key);
    expect(authorizationCodeProviderKey({ ...config, authorizeUrl: "https://other.example.com/authorize" })).not.toBe(key);
  });

  it("is unchanged when resource is absent, so every existing (non-MCP) caller keeps its key", () => {
    expect(authorizationCodeProviderKey(config)).toBe(
      `${config.authorizeUrl}::${config.clientId}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64),
    );
  });

  it("differs for two MCP servers that share an authorization server and client_id", () => {
    const serverA: AuthorizationCodeConfig = { ...config, resource: "https://mcp-a.example.com/mcp" };
    const serverB: AuthorizationCodeConfig = { ...config, resource: "https://mcp-b.example.com/mcp" };
    expect(authorizationCodeProviderKey(serverA)).not.toBe(authorizationCodeProviderKey(serverB));
    expect(authorizationCodeProviderKey(serverA)).toMatch(/^[a-zA-Z0-9-]+$/);
  });

  it("survives a very long authorizeUrl without losing the resource suffix", () => {
    const longConfig: AuthorizationCodeConfig = { ...config, authorizeUrl: `https://auth.example.com/${"x".repeat(200)}/authorize` };
    const serverA: AuthorizationCodeConfig = { ...longConfig, resource: "https://mcp-a.example.com/mcp" };
    const serverB: AuthorizationCodeConfig = { ...longConfig, resource: "https://mcp-b.example.com/mcp" };
    expect(authorizationCodeProviderKey(serverA)).not.toBe(authorizationCodeProviderKey(serverB));
  });
});

describe("authorizationCodeRefreshKey", () => {
  it("matches the key createAuthorizationCodeSession actually persists the refresh token under", async () => {
    const store = fakeStore();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
    const session = createAuthorizationCodeSession(config, store);
    await session.startSignIn(redirectTo.capture);
    await session.completeSignIn("abc", redirectTo.state(), fetchFn);

    expect(store.get(authorizationCodeRefreshKey(config))).toBe("rt");
  });

  it("does not need redirectUri or tokenUrl - a caller checking for a stored session has neither", () => {
    const { authorizeUrl, clientId, resource } = { ...config, resource: "https://mcp.example.com/mcp" };
    expect(authorizationCodeRefreshKey({ authorizeUrl, clientId, resource })).toBe(
      `afm.oauth.${authorizationCodeProviderKey({ authorizeUrl, clientId, resource })}.refresh`,
    );
  });
});

function fakeStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

describe("createAuthorizationCodeSession", () => {
  it("startSignIn redirects to a PKCE authorize URL and leaves no session yet", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    await session.startSignIn(redirectTo.capture);

    const url = new URL(redirectTo.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).not.toBeNull();
    expect(session.hasSession()).toBe(false);
  });

  it("exchanges the code for tokens when the state matches", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    await session.startSignIn(redirectTo.capture);
    const fetchFn = fakeFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600 }).fn;

    await session.completeSignIn("abc", redirectTo.state(), fetchFn);
    expect(session.hasSession()).toBe(true);
    expect(await session.getAccessToken()).toBe("at");
  });

  it("removes any previously stored refresh token before persisting a freshly signed-in one", async () => {
    const calls: string[] = [];
    const tracked = {
      get: (k: string) => fakeStore().get(k),
      set: (k: string, v: string) => void calls.push(`set:${v}`),
      remove: (_k: string) => void calls.push("remove"),
    };
    const session = createAuthorizationCodeSession(config, tracked);
    await session.startSignIn(redirectTo.capture);
    await session.completeSignIn("abc", redirectTo.state(), fakeFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600 }).fn);
    expect(calls).toEqual(["remove", "set:rt"]);
  });

  it("refuses a code when no sign-in is waiting for it", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    await expect(session.completeSignIn("abc", "someone-elses-state")).rejects.toThrow(/No OAuth2 sign-in is waiting/);
    expect(session.hasSession()).toBe(false);
  });

  describe("when the answer names the server it came from", () => {
    const issuer = "https://auth.example.com";
    const own = {
      issuer,
      authorization_endpoint: config.authorizeUrl,
      token_endpoint: config.tokenUrl,
      code_challenge_methods_supported: ["S256"],
    };

    function issuerFetch(metadata: unknown) {
      const calls: string[] = [];
      const fn = (async (url: string) => {
        calls.push(String(url));
        if (String(url) === config.tokenUrl) {
          return { ok: true, status: 200, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }) } as Response;
        }
        return metadata === null
          ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
          : ({ ok: true, status: 200, json: async () => metadata } as Response);
      }) as unknown as typeof fetch;
      return { fn, calls };
    }

    async function started() {
      const session = createAuthorizationCodeSession(config, fakeStore());
      await session.startSignIn(redirectTo.capture);
      return { session, state: redirectTo.state() };
    }

    it("exchanges the code when that server's endpoints are the ones this sign-in started with", async () => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch(own);
      await session.completeSignIn("abc", state, fn, issuer);
      expect(session.hasSession()).toBe(true);
      expect(calls).toContain(config.tokenUrl);
    });

    it("compares the endpoints as normalised URLs", async () => {
      const { session, state } = await started();
      const { fn } = issuerFetch({ ...own, token_endpoint: "https://auth.example.com:443/oauth2/token" });
      await session.completeSignIn("abc", state, fn, issuer);
      expect(session.hasSession()).toBe(true);
    });

    it.each([
      ["authorization", { authorization_endpoint: "https://elsewhere.example/authorize" }],
      ["token", { token_endpoint: "https://elsewhere.example/token" }],
    ])("refuses a server with a different %s endpoint, without exchanging the code", async (_label, different) => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch({ ...own, ...different });
      await expect(session.completeSignIn("abc", state, fn, issuer)).rejects.toThrow(/different server/);
      expect(calls).not.toContain(config.tokenUrl);
      expect(session.hasSession()).toBe(false);
    });

    it("refuses a server that publishes no metadata", async () => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch(null);
      await expect(session.completeSignIn("abc", state, fn, issuer)).rejects.toThrow(/different server/);
      expect(calls).not.toContain(config.tokenUrl);
    });

    it("refuses a server that is not https, without asking it anything", async () => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch(own);
      await expect(session.completeSignIn("abc", state, fn, "http://auth.example.com")).rejects.toThrow(/different server/);
      expect(calls).toEqual([]);
    });

    it("refuses an iss that is not a valid URL, without asking it anything", async () => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch(own);
      await expect(session.completeSignIn("abc", state, fn, "not a url")).rejects.toThrow(/different server/);
      expect(calls).toEqual([]);
    });

    it("looks nothing up when the answer names no server", async () => {
      const { session, state } = await started();
      const { fn, calls } = issuerFetch(null);
      await session.completeSignIn("abc", state, fn);
      expect(calls).toEqual([config.tokenUrl]);
    });
  });

  it("throws on a state mismatch (CSRF), and the sign-in cannot be retried with the right state", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    await session.startSignIn(redirectTo.capture);
    const state = redirectTo.state();
    const { fn, calls } = fakeFetch({ access_token: "at", expires_in: 3600 });

    await expect(session.completeSignIn("abc", "WRONG", fn)).rejects.toThrow(/state mismatch/i);
    await expect(session.completeSignIn("abc", state, fn)).rejects.toThrow(/No OAuth2 sign-in is waiting/);
    expect(calls).toHaveLength(0);
  });

  it("restore() resumes a session from a persisted refresh token", async () => {
    const persistentStore = fakeStore();
    persistentStore.set(`afm.oauth.${authorizationCodeProviderKey(config)}.refresh`, "saved-refresh");
    const session = createAuthorizationCodeSession(config, persistentStore);
    const fetchFn = fakeFetch({ access_token: "at3", expires_in: 3600 }).fn;
    const restored = await session.restore(fetchFn);
    expect(restored).toBe(true);
    expect(await session.getAccessToken(fetchFn)).toBe("at3");
  });

  it("restore() returns false when nothing was persisted", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    expect(await session.restore()).toBe(false);
  });

  it("getAccessToken refreshes an expired token automatically, and persists the rotated refresh token", async () => {
    const persistentStore = fakeStore();
    const session = createAuthorizationCodeSession(config, persistentStore);
    await session.startSignIn(redirectTo.capture);
    await session.completeSignIn("abc", redirectTo.state(), fakeFetch({ access_token: "expired-token", refresh_token: "rt", expires_in: 1 }).fn);

    const refreshFetch = fakeFetch({ access_token: "fresh-token", refresh_token: "rotated-rt", expires_in: 3600 }).fn;
    expect(await session.getAccessToken(refreshFetch)).toBe("fresh-token");
    expect(persistentStore.get(`afm.oauth.${authorizationCodeProviderKey(config)}.refresh`)).toBe("rotated-rt");
  });

  it("signOut clears the session and the persisted refresh token", async () => {
    const persistentStore = fakeStore();
    const session = createAuthorizationCodeSession(config, persistentStore);
    await session.startSignIn(redirectTo.capture);
    await session.completeSignIn("abc", redirectTo.state(), fakeFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600 }).fn);

    session.signOut();
    expect(session.hasSession()).toBe(false);
    expect(await session.restore()).toBe(false);
    expect(persistentStore.get(`afm.oauth.${authorizationCodeProviderKey(config)}.refresh`)).toBeNull();
  });
});

describe("isInteractiveOAuth", () => {
  it("is true only for oauth2 with the authorization_code grant, whatever the casing", () => {
    expect(isInteractiveOAuth({ type: "oauth2", grant_type: "authorization_code" })).toBe(true);
    expect(isInteractiveOAuth({ type: "OAuth2", grant_type: "Authorization_Code" })).toBe(true);
    expect(isInteractiveOAuth({ type: "oauth2", grant_type: "client_credentials" })).toBe(false);
    expect(isInteractiveOAuth({ type: "bearer" })).toBe(false);
    expect(isInteractiveOAuth({ type: 5, grant_type: 6 })).toBe(false);
    expect(isInteractiveOAuth(undefined)).toBe(false);
  });
});

describe("oauthProviderFrom", () => {
  it("maps an authentication block to a provider, with empty strings for anything missing", () => {
    expect(
      oauthProviderFrom({ authorize_url: "https://a/authorize", token_url: "https://a/token", client_id: "c", scopes: ["mcp"] }, "https://mcp.example.com/mcp"),
    ).toEqual({
      authorizeUrl: "https://a/authorize",
      tokenUrl: "https://a/token",
      clientId: "c",
      scopes: ["mcp"],
      resource: "https://mcp.example.com/mcp",
    });
    expect(oauthProviderFrom({})).toEqual({ authorizeUrl: "", tokenUrl: "", clientId: "", scopes: undefined, resource: undefined });
  });
});

// The agent file supplying these URLs is untrusted, so a file naming an insecure endpoint must
// stop the flow before the browser is sent anywhere or the login code leaves the page.
describe("insecure endpoints in an untrusted agent file", () => {
  const insecure = ["http://auth.example.com/oauth2/authorize", "javascript:alert(1)", "data:text/html,x"];

  it("refuses to build an authorize URL for a non-https endpoint", () => {
    for (const authorizeUrl of insecure) {
      expect(() => buildAuthorizeUrl({ ...config, authorizeUrl }, { state: "s", codeChallenge: "c" })).toThrow(
        /authorize_url/,
      );
    }
  });

  it("does not redirect the browser when authorize_url is not https", async () => {
    const session = createAuthorizationCodeSession(
      { ...config, authorizeUrl: "http://auth.example.com/oauth2/authorize" },
      fakeStore(),
    );
    let redirected: string | null = null;
    await expect(session.startSignIn((u) => void (redirected = u))).rejects.toThrow(/must use https/);
    expect(redirected).toBeNull();
  });

  it("does not POST the code or verifier when token_url is not https", async () => {
    for (const tokenUrl of ["http://auth.example.com/oauth2/token", "javascript:alert(1)"]) {
      const { fn, calls } = fakeFetch({ access_token: "at" });
      await expect(exchangeCodeForTokens({ ...config, tokenUrl }, "the-code", "the-verifier", fn)).rejects.toThrow(
        /token_url/,
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("does not POST the refresh token when token_url is not https", async () => {
    const { fn, calls } = fakeFetch({ access_token: "at" });
    await expect(
      refreshAuthorizationCodeTokens({ ...config, tokenUrl: "http://auth.example.com/oauth2/token" }, "rt", fn),
    ).rejects.toThrow(/token_url/);
    expect(calls).toHaveLength(0);
  });

  it("still lets an ordinary https provider through, redirect and exchange both", async () => {
    const session = createAuthorizationCodeSession(config, fakeStore());
    await session.startSignIn(redirectTo.capture);
    expect(redirectTo.url.startsWith("https://auth.example.com/oauth2/authorize?")).toBe(true);

    const { fn, calls } = fakeFetch({ access_token: "at", expires_in: 3600 });
    await session.completeSignIn("abc", redirectTo.state(), fn);
    expect(calls).toHaveLength(1);
  });
});

function scriptedFetch(responses: Array<{ status?: number; body?: unknown }>): typeof fetch {
  let call = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const entry = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return {
      ok: (entry.status ?? 200) < 400,
      status: entry.status ?? 200,
      json: async () => entry.body,
    } as Response;
  }) as unknown as typeof fetch;
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

describe("createOAuth2MachineClient", () => {
  it("client_credentials sends client_id/secret as HTTP Basic by default", async () => {
    const config: OAuth2MachineConfig = {
      grantType: "client_credentials",
      tokenUrl: "https://auth.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      scopes: ["read", "write"],
    };
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1", expires_in: 3600 } }]);
    const client = createOAuth2MachineClient(config);
    const token = await client.getAccessToken(fetchFn);
    expect(token).toBe("tok-1");

    const calls = (fetchFn as unknown as { calls: Array<{ url: string; init?: RequestInit }> }).calls;
    expect(calls[0]!.url).toBe("https://auth.example.com/token");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${btoa("id:secret")}`);
    const body = calls[0]!.init!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("read write");
    expect(body.get("client_id")).toBeNull();
  });

  it("post_body credential_bearer sends client_id/secret in the form body, not a header", async () => {
    const config: OAuth2MachineConfig = {
      grantType: "client_credentials",
      tokenUrl: "https://auth.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      credentialBearer: "post_body",
    };
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1" } }]);
    await createOAuth2MachineClient(config).getAccessToken(fetchFn);
    const calls = (fetchFn as unknown as { calls: Array<{ init?: RequestInit }> }).calls;
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = calls[0]!.init!.body as URLSearchParams;
    expect(body.get("client_id")).toBe("id");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("password grant sends username/password", async () => {
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1" } }]);
    await createOAuth2MachineClient({
      grantType: "password",
      tokenUrl: "https://auth.example.com/token",
      username: "u",
      password: "p",
    }).getAccessToken(fetchFn);
    const body = ((fetchFn as unknown as { calls: Array<{ init?: RequestInit }> }).calls[0]!.init!.body) as URLSearchParams;
    expect(body.get("grant_type")).toBe("password");
    expect(body.get("username")).toBe("u");
    expect(body.get("password")).toBe("p");
  });

  it("refresh_token grant sends refresh_token", async () => {
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1" } }]);
    await createOAuth2MachineClient({
      grantType: "refresh_token",
      tokenUrl: "https://auth.example.com/token",
      refreshToken: "rt-1",
    }).getAccessToken(fetchFn);
    const body = ((fetchFn as unknown as { calls: Array<{ init?: RequestInit }> }).calls[0]!.init!.body) as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
  });

  it("jwt_bearer grant sends the RFC 7523 URN and the assertion", async () => {
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1" } }]);
    await createOAuth2MachineClient({
      grantType: "jwt_bearer",
      tokenUrl: "https://auth.example.com/token",
      assertion: "signed-jwt",
    }).getAccessToken(fetchFn);
    const body = ((fetchFn as unknown as { calls: Array<{ init?: RequestInit }> }).calls[0]!.init!.body) as URLSearchParams;
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("assertion")).toBe("signed-jwt");
  });

  it("caches the token and does not re-fetch while still valid", async () => {
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1", expires_in: 3600 } }]);
    const client = createOAuth2MachineClient({ grantType: "client_credentials", tokenUrl: "https://x/token", clientId: "i", clientSecret: "s" });
    const first = await client.getAccessToken(fetchFn);
    const second = await client.getAccessToken(fetchFn);
    expect(first).toBe("tok-1");
    expect(second).toBe("tok-1");
    expect((fetchFn as unknown as { calls: unknown[] }).calls.length).toBe(1);
  });

  it("re-fetches once the cached token is within the expiry skew", async () => {
    const fetchFn = scriptedFetch([{ body: { access_token: "tok-1", expires_in: 1 } }, { body: { access_token: "tok-2", expires_in: 3600 } }]);
    const client = createOAuth2MachineClient({ grantType: "client_credentials", tokenUrl: "https://x/token", clientId: "i", clientSecret: "s" });
    const first = await client.getAccessToken(fetchFn);
    expect(first).toBe("tok-1");
    const second = await client.getAccessToken(fetchFn);
    expect(second).toBe("tok-2");
  });

  it("throws when the token endpoint returns a non-ok status", async () => {
    const fetchFn = scriptedFetch([{ status: 401, body: { error: "invalid_client" } }]);
    const client = createOAuth2MachineClient({ grantType: "client_credentials", tokenUrl: "https://x/token", clientId: "i", clientSecret: "s" });
    await expect(client.getAccessToken(fetchFn)).rejects.toThrow(/OAuth2 token request failed: 401/);
  });

  it("throws when the response has no access_token", async () => {
    const fetchFn = scriptedFetch([{ body: {} }]);
    const client = createOAuth2MachineClient({ grantType: "client_credentials", tokenUrl: "https://x/token", clientId: "i", clientSecret: "s" });
    await expect(client.getAccessToken(fetchFn)).rejects.toThrow(/did not contain 'access_token'/);
  });

  // The client_secret rides in this request, so an untrusted agent file must not be able to aim
  // it at a cleartext endpoint.
  it("never sends the client secret to a non-https token_url", async () => {
    for (const tokenUrl of ["http://auth.example.com/token", "javascript:alert(1)", "data:text/plain,x"]) {
      const fetchFn = scriptedFetch([{ body: { access_token: "tok" } }]);
      const client = createOAuth2MachineClient({ grantType: "client_credentials", tokenUrl, clientId: "i", clientSecret: "s" });
      await expect(client.getAccessToken(fetchFn)).rejects.toThrow(/token_url/);
      expect((fetchFn as unknown as { calls: unknown[] }).calls).toHaveLength(0);
    }
  });
});

describe("requireHttpsUrl", () => {
  it("accepts an https URL and returns it", () => {
    expect(requireHttpsUrl("https://gitlab.com/oauth/authorize", "authorize_url")).toBe(
      "https://gitlab.com/oauth/authorize",
    );
  });

  it("keeps the query and port an authorization server may need", () => {
    expect(requireHttpsUrl("https://id.example.com:8443/authorize?tenant=acme", "authorize_url")).toBe(
      "https://id.example.com:8443/authorize?tenant=acme",
    );
  });

  it("rejects cleartext http, naming the field", () => {
    expect(() => requireHttpsUrl("http://id.example.com/token", "token_url")).toThrow(/token_url/);
    expect(() => requireHttpsUrl("http://id.example.com/token", "token_url")).toThrow(/must use https/);
  });

  // Loopback is deliberately NOT exempt: these fields name an identity provider, and the one
  // value local development needs on http - the redirect_uri - is not one of them.
  it("rejects http on loopback too", () => {
    expect(() => requireHttpsUrl("http://localhost:8080/token", "token_url")).toThrow(/must use https/);
    expect(() => requireHttpsUrl("http://127.0.0.1:8080/token", "token_url")).toThrow(/must use https/);
  });

  it("rejects schemes that are not transport at all", () => {
    for (const raw of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd"]) {
      expect(() => requireHttpsUrl(raw, "authorize_url")).toThrow(/must use https/);
    }
  });

  it("rejects something that is not a URL", () => {
    for (const raw of ["", "   ", "not a url", "/oauth/authorize"]) {
      expect(() => requireHttpsUrl(raw, "token_url")).toThrow(/not a valid URL/);
    }
  });
});
