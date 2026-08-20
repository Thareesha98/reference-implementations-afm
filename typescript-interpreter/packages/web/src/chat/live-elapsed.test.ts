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
import { liveElapsedMs } from "./live-elapsed";

describe("liveElapsedMs", () => {
  it("returns the baseline unchanged right when it was received", () => {
    expect(liveElapsedMs(5000, 1000, 1000)).toBe(5000);
  });

  it("adds real wall-clock time that has passed since the baseline arrived", () => {
    expect(liveElapsedMs(5000, 1000, 3500)).toBe(7500);
  });

  it("never goes backwards if now is somehow before receivedAt", () => {
    expect(liveElapsedMs(5000, 3500, 1000)).toBe(5000);
  });
});
