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
import { MODEL_PROVIDERS, findProvider, shortModelLabel } from "./model-catalog";

describe("the model catalogue", () => {
  it("finds a provider by id, and reports one it does not know", () => {
    expect(findProvider("anthropic")?.secretName).toBe("ANTHROPIC_API_KEY");
    expect(findProvider("mystery")).toBeUndefined();
  });

  it("names every provider's key differently, so saving one never overwrites another", () => {
    const names = MODEL_PROVIDERS.map((provider) => provider.secretName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every provider at least one model, each with its own id", () => {
    for (const provider of MODEL_PROVIDERS) {
      const ids = provider.models.map((model) => model.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("shortens a known model and leaves an unlisted one as it is", () => {
    expect(shortModelLabel("gpt-4o-mini")).toBe("GPT-4o mini");
    expect(shortModelLabel("some-new-model")).toBe("some-new-model");
  });
});
