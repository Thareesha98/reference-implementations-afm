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

import { beforeEach, describe, expect, it, vi } from "vitest";

const PROXY = "https://proxy.example.net/relay";
const HEADER = "X-Choreo-Correlation-Id";
const ID_A = "afm-3f2b8c1e-5a47-4d0e-9b1c-7e6a2d9f4c10";
const ID_B = "afm-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CALLER_HEADERS: [string, string][] = [
  ["Authorization", "Bearer t"],
  ["Content-Type", "application/json"],
  ["Mcp-Protocol-Version", "2025-06-18"],
  ["Mcp-Session-Id", "m1"],
  ["Last-Event-ID", "7"],
  ["X-Api-Key", "k"],
];

let proxySessionFetch: typeof import("./proxy-session").proxySessionFetch;

beforeEach(async () => {
  vi.resetModules();
  ({ proxySessionFetch } = await import("./proxy-session"));
});

function reply(id?: string, status = 200, body: BodyInit | null = "{}"): Response {
  return new Response(body, { status, headers: id === undefined ? {} : { [HEADER]: id } });
}

function fakeProxy(...replies: Response[]) {
  const seen: Headers[] = [];
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return replies.shift() ?? reply();
  }) as typeof fetch;
  return { seen, send: proxySessionFetch(PROXY, fetchFn) };
}

const call = (send: typeof fetch, init?: RequestInit) => send(`${PROXY}?target=https%3A%2F%2Fa.example.com`, init);

describe("proxySessionFetch", () => {
  it("sends no id on the first request", async () => {
    const { seen, send } = fakeProxy();
    await call(send);
    expect(seen[0]?.has(HEADER)).toBe(false);
  });

  it("sends the id the proxy gave on every request after that", async () => {
    const { seen, send } = fakeProxy(reply(ID_A));
    await call(send);
    await call(send);
    await call(send);
    expect(seen.map((headers) => headers.get(HEADER))).toEqual([null, ID_A, ID_A]);
  });

  it("switches to a new id when the proxy hands one out", async () => {
    const { seen, send } = fakeProxy(reply(ID_A), reply(ID_B));
    await call(send);
    await call(send);
    await call(send);
    expect(seen.map((headers) => headers.get(HEADER))).toEqual([null, ID_A, ID_B]);
  });

  it.each([
    ["a value that is not ours", "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d"],
    ["a value that is far too long", `afm-${"x".repeat(80)}`],
  ])("ignores %s", async (_name, value) => {
    const { seen, send } = fakeProxy(reply(ID_A), reply(value));
    await call(send);
    await call(send);
    await call(send);
    expect(seen[2]?.get(HEADER)).toBe(ID_A);
  });

  it("keeps the id when an answer carries none", async () => {
    const { seen, send } = fakeProxy(reply(ID_A), reply());
    await call(send);
    await call(send);
    await call(send);
    expect(seen[2]?.get(HEADER)).toBe(ID_A);
  });

  it.each([400, 403, 429, 502, 504])("takes the id from a %i answer too", async (status) => {
    const { seen, send } = fakeProxy(reply(ID_A, status));
    await call(send);
    await call(send);
    expect(seen[1]?.get(HEADER)).toBe(ID_A);
  });

  it("takes the id as soon as the headers arrive, before the body is read", async () => {
    const endless = new ReadableStream<Uint8Array>();
    const { seen, send } = fakeProxy(reply(ID_A, 200, endless));
    const response = await call(send);
    await call(send);
    expect(seen[1]?.get(HEADER)).toBe(ID_A);
    await response.body?.cancel();
  });

  it("passes a 429 up as it came, status and body untouched", async () => {
    const tooMany = reply(ID_A, 429, JSON.stringify({ error: "Too many requests from this session" }));
    const { send } = fakeProxy(tooMany);
    const response = await call(send);
    expect(response).toBe(tooMany);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests from this session" });
  });

  it("never sends the id to any other address, and takes none from it", async () => {
    const { seen, send } = fakeProxy(reply(ID_A), reply(ID_B), reply(), reply());
    await call(send);
    await send("https://api.openai.com/v1/responses", { method: "POST" });
    await send("https://proxy.example.net:8443/relay");
    await send("http://proxy.example.net/relay");
    await call(send);
    expect(seen.map((headers) => headers.get(HEADER))).toEqual([null, null, null, null, ID_A]);
  });

  it.each([
    ["a plain object", Object.fromEntries(CALLER_HEADERS)],
    ["an array", CALLER_HEADERS],
    ["a Headers object", new Headers(CALLER_HEADERS)],
  ])("keeps the headers the caller gave as %s", async (_name, headers) => {
    const { seen, send } = fakeProxy(reply(ID_A));
    await call(send);
    await call(send, { headers });
    for (const [name, value] of CALLER_HEADERS) expect(seen[1]?.get(name)).toBe(value);
    expect(seen[1]?.get(HEADER)).toBe(ID_A);
  });

  it("keeps the headers of a Request passed as the first argument", async () => {
    const { seen, send } = fakeProxy(reply(ID_A));
    await call(send);
    await send(new Request(`${PROXY}?target=x`, { headers: { "X-Api-Key": "k" } }));
    expect(seen[1]?.get("x-api-key")).toBe("k");
    expect(seen[1]?.get(HEADER)).toBe(ID_A);
  });

  it("leaves the method, body and abort signal to the caller", async () => {
    let received: RequestInit | undefined;
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      received = init;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as typeof fetch;
    const controller = new AbortController();
    const pending = proxySessionFetch(PROXY, fetchFn)(PROXY, { method: "POST", body: "{}", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(received).toMatchObject({ method: "POST", body: "{}" });
  });
});
