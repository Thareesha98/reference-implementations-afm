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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceBar } from "./WorkspaceBar";

function bar(state: { canRun: boolean; running: boolean; agentsOpen?: boolean }): string {
  return renderToStaticMarkup(
    createElement(WorkspaceBar, {
      agentName: "Demo",
      saved: true,
      saveFailed: false,
      canAct: true,
      open: null,
      onToggle: () => {},
      agentsOpen: false,
      onToggleAgents: () => {},
      onRun: () => {},
      onToggleTheme: () => {},
      dark: false,
      ...state,
    }),
  );
}

describe("the Run button", () => {
  it("offers Run before the agent has started", () => {
    const html = bar({ canRun: true, running: false });
    expect(html).toContain("u-play");
    expect(html).not.toContain("Re-run");
    expect(html).not.toContain('disabled=""');
  });

  it("offers Re-run once the file differs from the running agent", () => {
    const html = bar({ canRun: true, running: true });
    expect(html).toContain("Re-run");
    expect(html).not.toContain('disabled=""');
  });

  it("is gone while the running agent already matches the file", () => {
    const html = bar({ canRun: false, running: true });
    expect(html).not.toContain("u-play");
    expect(html).not.toContain("Re-run");
  });

  it("stays, disabled, while the file cannot run yet", () => {
    const html = bar({ canRun: false, running: false });
    expect(html).toContain("u-play");
    expect(html).toContain('disabled=""');
  });
});

describe("the agent name", () => {
  it("reads as collapsed while the agents list is closed", () => {
    expect(bar({ canRun: true, running: false })).toContain('aria-expanded="false"');
  });

  it("reads as expanded while the agents list is open", () => {
    expect(bar({ canRun: true, running: false, agentsOpen: true })).toContain('aria-expanded="true"');
  });
});
