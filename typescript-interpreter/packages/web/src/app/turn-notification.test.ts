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
import { shouldNotify, notificationContent } from "./turn-notification";
import { initialChatState } from "../chat-state";
import type { ChatState } from "../chat-state";

describe("shouldNotify", () => {
  it("is true only on a streaming-to-ready transition while hidden, enabled and granted", () => {
    expect(shouldNotify("streaming", "ready", true, true, "granted")).toBe(true);
  });

  it("is false when the tab is visible", () => {
    expect(shouldNotify("streaming", "ready", false, true, "granted")).toBe(false);
  });

  it("is false when the preference is disabled", () => {
    expect(shouldNotify("streaming", "ready", true, false, "granted")).toBe(false);
  });

  it("is false when permission was not granted", () => {
    expect(shouldNotify("streaming", "ready", true, true, "denied")).toBe(false);
    expect(shouldNotify("streaming", "ready", true, true, "default")).toBe(false);
    expect(shouldNotify("streaming", "ready", true, true, "unsupported")).toBe(false);
  });

  it("is false for any transition that isn't streaming-to-ready", () => {
    expect(shouldNotify("connecting", "ready", true, true, "granted")).toBe(false);
    expect(shouldNotify("ready", "ready", true, true, "granted")).toBe(false);
    expect(shouldNotify("streaming", "streaming", true, true, "granted")).toBe(false);
    expect(shouldNotify("no-agent", "no-agent", true, true, "granted")).toBe(false);
  });
});

describe("notificationContent", () => {
  function withMessages(messages: ChatState["messages"]): ChatState {
    return { ...initialChatState, agentName: "Support Bot", messages };
  }

  it("prefers the error over a partial assistant message (a failed turn must not look successful)", () => {
    const state: ChatState = {
      ...withMessages([{ kind: "assistant", id: 1, text: "Let me check that for you..." }]),
      error: "Tool 'search' failed: timed out",
    };
    expect(notificationContent(state)).toEqual({
      title: "Support Bot",
      body: "Tool 'search' failed: timed out",
    });
  });

  it("uses the last assistant message when there is no error", () => {
    const state = withMessages([
      { kind: "user", id: 1, text: "hi" },
      { kind: "assistant", id: 2, text: "Hello there!" },
    ]);
    expect(notificationContent(state)).toEqual({ title: "Support Bot", body: "Hello there!" });
  });

  it("falls back to a generic message when there is no error and no assistant message yet", () => {
    const state = withMessages([{ kind: "user", id: 1, text: "hi" }]);
    expect(notificationContent(state)).toEqual({ title: "Support Bot", body: "Your agent finished responding." });
  });

  it("falls back to 'AFM Agent' when the agent has no name", () => {
    const state = { ...withMessages([]), agentName: "" };
    expect(notificationContent(state).title).toBe("AFM Agent");
  });

  it("truncates a long body to 140 characters", () => {
    const long = "x".repeat(300);
    const state = withMessages([{ kind: "assistant", id: 1, text: long }]);
    expect(notificationContent(state).body).toHaveLength(140);
  });
});
