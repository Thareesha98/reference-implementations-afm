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
import { canStartQuietly } from "./quiet-start";

const MODEL_KEY = ["---", "name: A", "model:", "  provider: openai", "  name: gpt-4o", "  authentication:", "    type: api-key", "    api_key: ${env:OPENAI_API_KEY}", "---", "", "# Role", "r", "", "# Instructions", "i", ""].join("\n");
const LITERAL_KEY = MODEL_KEY.replace("${env:OPENAI_API_KEY}", "sk-typed-in");
const TOOL_TOKEN = MODEL_KEY.replace(
  "---\n\n# Role",
  ["tools:", "  mcp:", "    - name: hf", "      transport:", "        type: http", "        url: https://huggingface.co/mcp", "        authentication:", "          type: bearer", "          token: ${env:HF_TOKEN}", "---", "", "# Role"].join("\n"),
);

const held = (savedSecrets: string[], passkeySecrets: string[] = []) => ({ savedSecrets, passkeySecrets });

describe("canStartQuietly", () => {
  it("starts an agent whose keys are all open in this tab", () => {
    expect(canStartQuietly(MODEL_KEY, held(["OPENAI_API_KEY"]))).toBe(true);
  });

  it("starts an agent that names no key at all", () => {
    expect(canStartQuietly(LITERAL_KEY, held([]))).toBe(true);
  });

  it("waits when the key it needs is sealed and not yet opened", () => {
    expect(canStartQuietly(MODEL_KEY, held([], ["OPENAI_API_KEY"]))).toBe(false);
  });

  it("waits when the key it needs was never entered", () => {
    expect(canStartQuietly(MODEL_KEY, held([]))).toBe(false);
  });

  it("waits when any one of several keys is missing", () => {
    expect(canStartQuietly(TOOL_TOKEN, held(["OPENAI_API_KEY"]))).toBe(false);
    expect(canStartQuietly(TOOL_TOKEN, held(["OPENAI_API_KEY", "HF_TOKEN"]))).toBe(true);
  });

  it("waits while anything is sealed and unopened, even a key this file does not name", () => {
    expect(canStartQuietly(LITERAL_KEY, held([], ["HF_TOKEN"]))).toBe(false);
  });

  it("starts once everything sealed has been opened", () => {
    expect(canStartQuietly(MODEL_KEY, held(["OPENAI_API_KEY", "HF_TOKEN"], ["OPENAI_API_KEY", "HF_TOKEN"]))).toBe(true);
  });
});
