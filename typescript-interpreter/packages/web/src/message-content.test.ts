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
import { userContent } from "./message-content";
import type { ImageAttachment } from "./protocol";

const first: ImageAttachment = { name: "one.png", data: "first", mediaType: "image/png" };
const second: ImageAttachment = { name: "two.jpg", data: "second", mediaType: "image/jpeg" };

describe("userContent", () => {
  it.each(["", " \n\t", " hello ", "සිංහල 🦀", "a\r\nb"])("preserves text without images: %j", (text) => {
    expect(userContent(text)).toBe(text);
    expect(userContent(text, [])).toBe(text);
  });

  it("preserves text and image order, but omits UI-only filenames", () => {
    expect(userContent(" hello ", [first, second])).toEqual([
      { type: "text", text: " hello " },
      { type: "image", data: "first", mediaType: "image/png" },
      { type: "image", data: "second", mediaType: "image/jpeg" },
    ]);
  });

  it.each(["", " \n\t", "\u00a0"])("omits blank text only when images are present: %j", (text) => {
    expect(userContent(text, [first])).toEqual([{ type: "image", data: "first", mediaType: "image/png" }]);
  });

  it("does not mutate or retain an image object from the UI", () => {
    const images = [Object.freeze({ ...first })];
    Object.freeze(images);
    const result = userContent("hello", images);
    expect(images).toEqual([first]);
    expect(Array.isArray(result) && result[1]).not.toBe(images[0]);
  });
});
