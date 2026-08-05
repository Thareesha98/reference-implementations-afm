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
import { modelFromMetadata } from "./model-factory";

describe("modelFromMetadata", () => {
  it("builds an OpenAI model port", async () => {
    const port = await modelFromMetadata({
      provider: "openai",
      name: "gpt-4o",
      authentication: { type: "api-key", api_key: "sk-1" },
    });
    expect(typeof port.stream).toBe("function");
  });

  it("builds an Anthropic model port", async () => {
    const port = await modelFromMetadata({
      provider: "anthropic",
      authentication: { type: "api-key", api_key: "sk-1" },
    });
    expect(typeof port.stream).toBe("function");
  });

  it("defaults to OpenAI when no provider is given", async () => {
    const port = await modelFromMetadata({ authentication: { type: "bearer", token: "sk-1" } });
    expect(typeof port.stream).toBe("function");
  });

  it("throws when no key was resolved", async () => {
    await expect(modelFromMetadata({ provider: "openai" })).rejects.toThrow(/key/i);
  });

  // Clearing the field in the Model panel writes `api_key: ""`. Letting that through sent an
  // empty Authorization header, and the provider's 401 comes back unreadable to the browser.
  it("treats a blank key as no key at all", async () => {
    await expect(
      modelFromMetadata({ provider: "openai", authentication: { type: "api-key", api_key: "" } }),
    ).rejects.toThrow(/key/i);
    await expect(
      modelFromMetadata({ provider: "openai", authentication: { type: "bearer", token: "   " } }),
    ).rejects.toThrow(/key/i);
  });

  it("throws for an unsupported provider", async () => {
    await expect(
      modelFromMetadata({ provider: "gemini", authentication: { type: "api-key", api_key: "k" } }),
    ).rejects.toThrow(/provider/i);
  });
});
