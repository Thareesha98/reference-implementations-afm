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
import { ServerTools } from "./server-panel-sections";

const tools = (found: { name: string }[] | null) =>
  renderToStaticMarkup(
    createElement(ServerTools, {
      url: "https://mcp.example.com/mcp",
      probing: false,
      found,
      error: null,
      allowed: ["search"],
      waiting: "Check again to list this server's tools.",
      onToggle: () => {},
      onToggleAll: () => {},
      onCheckAgain: () => {},
      checkable: true,
      showTip: () => {},
      hideTip: () => {},
    }),
  );

describe("a server's tool list", () => {
  it("says that a ticked tool runs without asking and an unticked one stays off", () => {
    expect(tools([{ name: "search" }, { name: "delete" }])).toContain("Ticked tools run without asking. Unticked tools stay off.");
  });

  it("says nothing about asking before there are any tools to tick", () => {
    expect(tools(null)).not.toContain("run without asking");
    expect(tools([])).not.toContain("run without asking");
  });
});
