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
import { grownHeight, MAX_COMPOSER_HEIGHT } from "./composer-size";

describe("sizing the message box", () => {
  it("takes the content height while it fits", () => {
    expect(grownHeight(600, 26)).toBe(26);
    expect(grownHeight(600, 90)).toBe(90);
  });

  it("stops at the cap and lets the box scroll instead", () => {
    expect(grownHeight(600, 4000)).toBe(MAX_COMPOSER_HEIGHT);
  });

  it("stops at a cap of its own for a box that is not the message box", () => {
    expect(grownHeight(300, 90, 200)).toBe(90);
    expect(grownHeight(300, 4000, 200)).toBe(200);
  });

  // The workspace opens with the conversation collapsed to zero width. Measuring the box there
  // returns a wrapped-to-one-character-per-line height, and it stays pinned once the pane opens.
  it("refuses to answer for a box that is not on screen", () => {
    expect(grownHeight(0, 4000)).toBeNull();
    expect(grownHeight(0, 26)).toBeNull();
  });

  it("treats a negative width the same as none", () => {
    expect(grownHeight(-10, 26)).toBeNull();
  });
});
