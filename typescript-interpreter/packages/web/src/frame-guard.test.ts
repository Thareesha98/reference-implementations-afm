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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isFramed } from "./frame-guard";

describe("isFramed", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("is false when the page is the top-level window", () => {
    const win: { top?: unknown } = {};
    win.top = win;
    vi.stubGlobal("window", win);
    expect(isFramed()).toBe(false);
  });

  it("is true when another window sits above the page", () => {
    vi.stubGlobal("window", { top: {} });
    expect(isFramed()).toBe(true);
  });

  it("is true when the top window cannot be read", () => {
    vi.stubGlobal("window", {
      get top(): unknown {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(isFramed()).toBe(true);
  });

  it("is true when the page has no top window", () => {
    vi.stubGlobal("window", { top: null });
    expect(isFramed()).toBe(true);
  });
});

describe("the entry point", () => {
  it("asks whether it is framed before it mounts anything", () => {
    const source = readFileSync(fileURLToPath(new URL("./main.tsx", import.meta.url)), "utf8");
    const guard = source.indexOf("isFramed()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf("createRoot("));
  });
});
