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
import { inPlainWords } from "./issue-words";
import type { AfmIssue } from "../../agent-validation";

const issue = (message: string, field = ""): AfmIssue => ({ severity: "error", message, field, line: null });

describe("saying the problem in words a person can act on", () => {
  it("turns the role error into an instruction", () => {
    const plain = inPlainWords(issue("Missing required '# Role' section"));
    expect(plain.text).toBe("Tell the agent who it is.");
    expect(plain.target).toBe("role");
  });

  it("turns the instructions error into an instruction", () => {
    expect(inPlainWords(issue("Missing required '# Instructions' section")).target).toBe("instructions");
  });

  it("points a missing model at the model", () => {
    const plain = inPlainWords(issue("`model` is required.", "model"));
    expect(plain.text).toBe("Choose a model for it to think with.");
    expect(plain.target).toBe("model");
  });

  it("names the setting it does not recognise", () => {
    expect(inPlainWords(issue("Unknown field 'colour'.")).text).toContain('"colour"');
  });

  // A wrong friendly message is worse than an unfriendly true one.
  it("leaves anything it does not recognise exactly as it was", () => {
    const odd = "Expected array, received null";
    expect(inPlainWords(issue(odd)).text).toBe(odd);
  });

  it("always keeps the original wording alongside", () => {
    expect(inPlainWords(issue("Missing required '# Role' section")).detail)
      .toBe("Missing required '# Role' section");
  });
});
