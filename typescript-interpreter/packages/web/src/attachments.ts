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

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { FileInfo } from "@afm/adapter-tool";
import type { ImageAttachment } from "./protocol";
import { fileExtension } from "./chat/attachment";

const MAX_FILES = 100;

export interface CollectedFile {
  file: File;
  path: string;
}

export interface CollectResult {
  files: CollectedFile[];
  truncated: boolean;
}

function relativePathOf(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath !== undefined && withPath.webkitRelativePath !== ""
    ? withPath.webkitRelativePath
    : file.name;
}

export function collectFromFileList(list: FileList): CollectResult {
  const files: CollectedFile[] = [];
  let truncated = false;
  for (const file of Array.from(list)) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    files.push({ file, path: relativePathOf(file) });
  }
  return { files, truncated };
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

export async function collectFromDataTransfer(items: DataTransferItemList): Promise<CollectResult> {
  const files: CollectedFile[] = [];
  let truncated = false;

  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      const file = await entryToFile(entry as FileSystemFileEntry);
      files.push({ file, path: `${prefix}${entry.name}` });
      return;
    }
    if (entry.isDirectory) {
      const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
      for (const child of children) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          break;
        }
        await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }

  const roots: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry !== null && entry !== undefined) roots.push(entry);
  }

  for (const entry of roots) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    await walk(entry, "");
  }

  return { files, truncated };
}

export function supportsDirectoryDrop(items: DataTransferItemList): boolean {
  return items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function";
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(["pdf", "md", "markdown", "txt"]);

export type ExtractResult = { ok: true; file: FileInfo } | { ok: false; name: string; reason: string };

async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pageTexts.push(`--- Page ${pageNumber} ---\n${text}`);
    }
    return { text: pageTexts.join("\n\n"), pages: doc.numPages };
  } finally {
    await doc.cleanup();
  }
}

export async function extractFile(file: File, path: string = file.name): Promise<ExtractResult> {
  const cleanPath = path.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ");
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, name: file.name, reason: `is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB` };
  }

  const ext = fileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, name: file.name, reason: "is not a supported file type (PDF, Markdown, or plain text only)" };
  }

  try {
    if (ext === "pdf") {
      const { text, pages } = await extractPdfText(file);
      return { ok: true, file: { name: file.name, path: cleanPath, text, pages } };
    }
    const text = await file.text();
    return { ok: true, file: { name: file.name, path: cleanPath, text } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, name: file.name, reason: `couldn't be read: ${message}` };
  }
}

export interface BatchExtractResult {
  attached: FileInfo[];
  skipped: { name: string; reason: string }[];
}

export async function extractFiles(collected: CollectedFile[]): Promise<BatchExtractResult> {
  const results = await Promise.all(collected.map(({ file, path }) => extractFile(file, path)));
  const attached: FileInfo[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const result of results) {
    if (result.ok) attached.push(result.file);
    else skipped.push({ name: result.name, reason: result.reason });
  }
  return { attached, skipped };
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_ACCEPT = IMAGE_MEDIA_TYPES.join(",");

export function isSupportedImageFile(file: File): boolean {
  return IMAGE_MEDIA_TYPES.includes(file.type);
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export interface ImagePickOutcome {
  attached: ImageAttachment[];
  skipped: { name: string; reason: string }[];
}

export async function pickImages(files: File[], alreadyStaged: number): Promise<ImagePickOutcome> {
  const attached: ImageAttachment[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let slotsLeft = Math.max(0, MAX_IMAGES_PER_MESSAGE - alreadyStaged);

  for (const file of files) {
    if (!isSupportedImageFile(file)) {
      skipped.push({ name: file.name, reason: "is not a supported image type (PNG, JPEG, WEBP, or GIF)" });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      skipped.push({ name: file.name, reason: `is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` });
      continue;
    }
    if (slotsLeft <= 0) {
      skipped.push({ name: file.name, reason: `would exceed the ${MAX_IMAGES_PER_MESSAGE}-image limit per message` });
      continue;
    }
    slotsLeft -= 1;
    attached.push({ name: file.name, mediaType: file.type, data: await toBase64(file) });
  }

  return { attached, skipped };
}
