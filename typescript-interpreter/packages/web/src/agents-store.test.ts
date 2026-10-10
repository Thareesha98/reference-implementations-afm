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
import { clear, findAgent, loadAgents, removeAgent, saveAgent } from "./agents-store";

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
}

const draft = (name: string, source = "---\nname: x\n---") => ({ name, description: `${name} agent`, source, origin: "blank" as const });

describe("the agents library", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("starts empty", () => {
    expect(loadAgents()).toEqual([]);
  });

  it("saves a new agent under a fresh id and reports that it landed", () => {
    const result = saveAgent(draft("Scribe"));
    expect(result.persisted).toBe(true);
    expect(result.saved).toMatchObject({ name: "Scribe", origin: "blank" });
    expect(result.saved.id).not.toBe("");
    expect(loadAgents()).toEqual([result.saved]);
  });

  it("keeps the newest agent first", () => {
    saveAgent(draft("First"));
    const second = saveAgent(draft("Second")).saved;
    expect(loadAgents()[0]).toEqual(second);
    expect(loadAgents().map((agent) => agent.name)).toEqual(["Second", "First"]);
  });

  it("updates in place when an id is given, keeping what is not being changed", () => {
    const created = saveAgent(draft("Scribe")).saved;
    const updated = saveAgent({ ...draft("Scribe v2"), id: created.id }).saved;

    expect(loadAgents()).toHaveLength(1);
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Scribe v2");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it("finds an agent by id, and reports one that is gone", () => {
    const saved = saveAgent(draft("Scribe")).saved;
    expect(findAgent(saved.id)).toEqual(saved);
    expect(findAgent("missing")).toBeNull();
  });

  it("removes one agent and leaves the rest", () => {
    const keep = saveAgent(draft("Keep")).saved;
    const drop = saveAgent(draft("Drop")).saved;
    expect(removeAgent(drop.id)).toEqual([keep]);
    expect(loadAgents()).toEqual([keep]);
  });

  it("clears the library", () => {
    saveAgent(draft("One"));
    expect(clear()).toEqual([]);
    expect(loadAgents()).toEqual([]);
  });

  it("says so when the browser refuses the write, instead of pretending it was saved", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(saveAgent(draft("Scribe")).persisted).toBe(false);
  });
});
