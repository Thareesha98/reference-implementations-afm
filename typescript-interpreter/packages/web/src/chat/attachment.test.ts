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
import { attachedFilesOf, attachmentBadge, describeAttachment, fileExtension } from "./attachment";
import type { UiMessage } from "../chat-state";

type AttachmentMessage = Extract<UiMessage, { kind: "attachment" }>;

describe("attachment helpers", () => {
  it("reads the extension, including from a name with dots in it", () => {
    expect(fileExtension("microservices-research.pdf")).toBe("pdf");
    expect(fileExtension("notes.v2.final.MD")).toBe("md");
    expect(fileExtension("README")).toBe("");
  });

  it("badges a file by type, and falls back for anything unknown", () => {
    expect(attachmentBadge("paper.pdf")).toBe("PDF");
    expect(attachmentBadge("notes.markdown")).toBe("MD");
    expect(attachmentBadge("log.txt")).toBe("TXT");
    expect(attachmentBadge("data.csv")).toBe("CSV");
    expect(attachmentBadge("LICENSE")).toBe("FILE");
  });

  it("describes a PDF by page count and a text file by extracted size", () => {
    expect(describeAttachment({ name: "paper.pdf", chars: 48_120, pages: 11 })).toBe("PDF · 11 pages");
    expect(describeAttachment({ name: "one.pdf", pages: 1 })).toBe("PDF · 1 page");
    expect(describeAttachment({ name: "notes.md", chars: 4201 })).toBe("Markdown · 4 KB");
    expect(describeAttachment({ name: "tiny.txt", chars: 12 })).toBe("Text · 12 characters");
    expect(describeAttachment({ name: "unknown.bin" })).toBe("File");
  });

  it("reads the current attachment shape", () => {
    const message: AttachmentMessage = {
      kind: "attachment",
      id: 1,
      files: [{ name: "paper.pdf", chars: 100, pages: 3 }],
    };
    expect(attachedFilesOf(message)).toEqual([{ name: "paper.pdf", chars: 100, pages: 3 }]);
  });

  it("still reads a conversation saved with the old name-only shape", () => {
    const legacy = { kind: "attachment", id: 1, names: ["report.pdf", "notes.md"] } as unknown as AttachmentMessage;
    expect(attachedFilesOf(legacy)).toEqual([{ name: "report.pdf" }, { name: "notes.md" }]);
  });

  it("returns nothing rather than throwing on a message with neither shape", () => {
    const broken = { kind: "attachment", id: 1 } as unknown as AttachmentMessage;
    expect(attachedFilesOf(broken)).toEqual([]);
  });
});
