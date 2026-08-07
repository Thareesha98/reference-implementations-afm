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
import { loadJsonArray, loadText, saveJson, saveText } from "./local-json-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const blockedStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

describe("local storage helpers", () => {
  beforeEach(() => vi.unstubAllGlobals());

  describe("loadText and saveText", () => {
    it("write a string and read it back", () => {
      vi.stubGlobal("localStorage", memoryStorage());
      expect(saveText("k", "v")).toBe(true);
      expect(loadText("k")).toBe("v");
    });

    it("read nothing for a key that was never written", () => {
      vi.stubGlobal("localStorage", memoryStorage());
      expect(loadText("missing")).toBeNull();
    });

    it("do not throw when the browser blocks site storage", () => {
      vi.stubGlobal("localStorage", blockedStorage);
      expect(loadText("k")).toBeNull();
      expect(saveText("k", "v")).toBe(false);
    });

    it("report a refused write, such as a full quota", () => {
      vi.stubGlobal("localStorage", {
        ...memoryStorage(),
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
      });
      expect(saveText("k", "v")).toBe(false);
    });
  });

  describe("loadJsonArray", () => {
    it("reads a stored list", () => {
      vi.stubGlobal("localStorage", memoryStorage({ list: JSON.stringify([1, 2, 3]) }));
      expect(loadJsonArray<number>("list")).toEqual([1, 2, 3]);
    });

    it.each([
      ["nothing stored", {}],
      ["corrupt text", { list: "{not json" }],
      ["something that is not a list", { list: JSON.stringify({ a: 1 }) }],
    ])("counts %s as empty", (_label, stored) => {
      vi.stubGlobal("localStorage", memoryStorage(stored));
      expect(loadJsonArray("list")).toEqual([]);
    });

    it("counts blocked storage as empty", () => {
      vi.stubGlobal("localStorage", blockedStorage);
      expect(loadJsonArray("list")).toEqual([]);
    });
  });

  describe("saveJson", () => {
    it("stores the value as JSON and says it landed", () => {
      const storage = memoryStorage();
      vi.stubGlobal("localStorage", storage);
      expect(saveJson("list", [{ a: 1 }])).toBe(true);
      expect(storage.map.get("list")).toBe('[{"a":1}]');
    });

    it("says so when the write is refused", () => {
      vi.stubGlobal("localStorage", blockedStorage);
      expect(saveJson("list", [1])).toBe(false);
    });

    it("says so for a value that cannot be written as JSON", () => {
      vi.stubGlobal("localStorage", memoryStorage());
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(saveJson("list", circular)).toBe(false);
    });
  });
});
