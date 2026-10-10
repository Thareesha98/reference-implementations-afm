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
import { ServerDirectory } from "./ServerDirectory";
import { DIRECTORY_ENTRIES } from "../../mcp-directory";

function directory(query: string): string {
  return renderToStaticMarkup(createElement(ServerDirectory, { query, onConnect: () => {}, onInfo: () => {} }));
}

function rows(html: string): number {
  return html.split('class="u-srv-row"').length - 1;
}

describe("the directory list", () => {
  it("shows every server with a Connect button when nothing is typed", () => {
    const html = directory("");
    expect(rows(html)).toBe(DIRECTORY_ENTRIES.length);
    expect(html.split("Connect</button>").length - 1).toBe(DIRECTORY_ENTRIES.length);
  });

  it("narrows to the servers that match what is typed", () => {
    const html = directory("linear");
    expect(rows(html)).toBe(1);
    expect(html).toContain("Linear");
    expect(html).not.toContain("Notion");
  });

  it("prints the publisher's domain, and the address as its tooltip", () => {
    const html = directory("linear");
    expect(html).toContain("linear.app");
    expect(html).toContain('title="https://mcp.linear.app/mcp"');
  });

  it("points at Add by URL when nothing matches", () => {
    const html = directory("zzzz");
    expect(rows(html)).toBe(0);
    expect(html).toContain("Nothing here matches that");
    expect(html).toContain("Add by URL");
  });

  it("offers a way to read about each server", () => {
    expect(directory("notion")).toContain('aria-label="About Notion"');
  });
});

describe("the directory list's header", () => {
  it("has no recently connected group, only the servers themselves", () => {
    expect(directory("")).not.toContain("Recently connected");
    expect(rows(directory(""))).toBe(DIRECTORY_ENTRIES.length);
  });
});
