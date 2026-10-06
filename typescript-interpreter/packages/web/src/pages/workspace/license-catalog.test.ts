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

import { describe, expect, it } from "vitest";
import { buildableAgent } from "../../agent-validation";
import { setFrontmatterValue } from "./agent-source-edit";
import { LICENSES } from "./license-catalog";

describe("LICENSES", () => {
  it("lists each license once, with a note", () => {
    expect(new Set(LICENSES.map((license) => license.id)).size).toBe(LICENSES.length);
    for (const license of LICENSES) expect(license.note).not.toBe("");
  });

  it("writes every choice into a file that reads back as that license", () => {
    for (const license of LICENSES) {
      const next = setFrontmatterValue("---\nname: A\n---\n\n# Role\nr\n", "license", license.id);
      expect(next).toContain(`license: ${license.id}`);
      const read = buildableAgent(next);
      expect(read.ok && read.metadata.license).toBe(license.id);
    }
  });
});
