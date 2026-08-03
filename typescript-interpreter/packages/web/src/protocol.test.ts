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

import { describe, it, expect } from "vitest";
import { serverMessageFromLoopEvent, permissionKey } from "./protocol";
import type { LoopEvent } from "@afm/engine";

describe("serverMessageFromLoopEvent", () => {
  it("passes a text-delta through", () => {
    expect(serverMessageFromLoopEvent({ type: "text-delta", text: "hi" })).toEqual({
      type: "text-delta",
      text: "hi",
    });
  });

  it("renames finish to turn-finished", () => {
    expect(serverMessageFromLoopEvent({ type: "finish", reason: "stop" })).toEqual({
      type: "turn-finished",
      reason: "stop",
    });
  });

  it("maps a tool-result", () => {
    const event: LoopEvent = { type: "tool-result", id: "c1", name: "t", ok: true, content: "r" };
    expect(serverMessageFromLoopEvent(event)).toEqual({
      type: "tool-result",
      id: "c1",
      name: "t",
      ok: true,
      content: "r",
    });
  });

  it("leaves a tool's images and audio in the worker, since nothing on the page shows them", () => {
    const event: LoopEvent = {
      type: "tool-result",
      id: "c1",
      name: "t",
      ok: true,
      content: "r",
      media: [{ kind: "image", data: "AAAA", mediaType: "image/png" }],
    };
    expect(serverMessageFromLoopEvent(event)).not.toHaveProperty("media");
  });

  it("passes a budget-update through", () => {
    const event: LoopEvent = {
      type: "budget-update",
      totalTokens: 120,
      inputTokens: 80,
      outputTokens: 40,
      maxTokens: 250_000,
      iteration: 1,
      maxIterations: 10,
      elapsedMs: 340,
      maxWallClockMs: 180_000,
    };
    expect(serverMessageFromLoopEvent(event)).toEqual({
      type: "budget-update",
      totalTokens: 120,
      inputTokens: 80,
      outputTokens: 40,
      maxTokens: 250_000,
      iteration: 1,
      maxIterations: 10,
      elapsedMs: 340,
      maxWallClockMs: 180_000,
    });
  });
});

describe("permissionKey", () => {
  it("keeps the same tool name on different servers apart", () => {
    const good = permissionKey("https://good.example/mcp", "search");
    const evil = permissionKey("https://attacker.example/mcp", "search");
    expect(good).not.toBe(evil);
  });

  it("is stable for the same server and tool", () => {
    expect(permissionKey("https://a/mcp", "x")).toBe(permissionKey("https://a/mcp", "x"));
  });

  it("keys in-page tools under 'local'", () => {
    expect(permissionKey(undefined, "read_file")).toBe("local::read_file");
  });

  it("does not let a server-scoped grant satisfy an in-page tool of the same name", () => {
    expect(permissionKey("https://a/mcp", "read_file")).not.toBe(permissionKey(undefined, "read_file"));
  });
});
