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

import type { AttachedFile, UiMessage } from "../chat-state";

type AttachmentMessage = Extract<UiMessage, { kind: "attachment" }>;

const TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  md: "Markdown",
  markdown: "Markdown",
  txt: "Text",
};

const BADGES: Record<string, string> = {
  pdf: "PDF",
  md: "MD",
  markdown: "MD",
  txt: "TXT",
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// Older saved conversations hold a plain name list; reopening one must not blank what was attached.
export function attachedFilesOf(message: AttachmentMessage): AttachedFile[] {
  if (Array.isArray(message.files)) return message.files;
  const legacy = (message as { names?: unknown }).names;
  if (!Array.isArray(legacy)) return [];
  return legacy.filter((name): name is string => typeof name === "string").map((name) => ({ name }));
}

// The worker holds a file under its path; older saved conversations only had a name.
export function attachedFileKey(file: AttachedFile): string {
  return file.path ?? file.name;
}

export function attachmentBadge(name: string): string {
  const extension = fileExtension(name);
  return BADGES[extension] ?? (extension === "" ? "FILE" : extension.slice(0, 4).toUpperCase());
}

export function describeAttachment(file: AttachedFile): string {
  const label = TYPE_LABELS[fileExtension(file.name)] ?? "File";
  if (file.pages !== undefined) return `${label} · ${file.pages} page${file.pages === 1 ? "" : "s"}`;
  if (file.chars !== undefined) {
    return file.chars < 1024 ? `${label} · ${file.chars} characters` : `${label} · ${Math.round(file.chars / 1024)} KB`;
  }
  return label;
}
