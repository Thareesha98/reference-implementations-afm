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

import { describe, expect, it } from "vitest";
import { headerStatus } from "./ChatHead";

describe("headerStatus", () => {
  it("says nothing before the agent has started", () => {
    expect(headerStatus("no-agent", "idle")).toBeNull();
  });

  it("describes the agent while it is idle", () => {
    expect(headerStatus("ready", "idle")).toEqual({ tone: "ok", label: "Ready" });
    expect(headerStatus("connecting", "idle")?.label).toBe("Starting");
    expect(headerStatus("not-ready", "idle")?.tone).toBe("bad");
  });

  it("names the server while one of its tools runs", () => {
    expect(headerStatus("streaming", "tool", "huggingface")).toEqual({ tone: "warn", label: "Using huggingface" });
    expect(headerStatus("streaming", "tool")?.label).toBe("Using a tool");
  });

  it("says what the model is doing around a tool call", () => {
    expect(headerStatus("streaming", "thinking")?.label).toBe("Thinking");
    expect(headerStatus("streaming", "from-tool")?.label).toBe("Thinking");
    expect(headerStatus("streaming", "answering")?.label).toBe("Answering");
  });
});
