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

import { parse as parseYaml, YAMLParseError } from "yaml";
import { AfmParseError } from "./errors";

const DELIMITER = "---";

export interface FrontmatterSplit {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

type FrontmatterScan =
  | { kind: "none" }
  | { kind: "unclosed" }
  | { kind: "found"; yamlStart: number; end: number; bodyStart: number };

function scanFrontmatter(content: string): FrontmatterScan {
  let firstStart = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (firstStart < content.length) {
    const end = content.indexOf("\n", firstStart);
    const lineEnd = end === -1 ? content.length : end;
    if (content.slice(firstStart, lineEnd).trim() !== "") break;
    firstStart = end === -1 ? content.length : end + 1;
  }
  const firstBreak = content.indexOf("\n", firstStart);
  const firstEnd = firstBreak === -1 ? content.length : firstBreak;
  const firstLine = content.slice(firstStart, firstEnd).trimEnd();
  if (firstLine !== DELIMITER) {
    return { kind: "none" };
  }

  const yamlStart = firstBreak === -1 ? content.length : firstBreak + 1;
  let lineStart = yamlStart;
  while (lineStart < content.length) {
    const breakAt = content.indexOf("\n", lineStart);
    const lineEnd = breakAt === -1 ? content.length : breakAt;
    if (content.slice(lineStart, lineEnd).trimEnd() === DELIMITER) {
      return {
        kind: "found",
        yamlStart,
        end: lineStart,
        bodyStart: breakAt === -1 ? content.length : breakAt + 1,
      };
    }
    if (breakAt === -1) {
      break;
    }
    lineStart = breakAt + 1;
  }
  return { kind: "unclosed" };
}

export function frontmatterEndOffset(content: string): number {
  const scan = scanFrontmatter(content);
  return scan.kind === "found" ? scan.end : 0;
}

export function splitFrontmatter(content: string): FrontmatterSplit {
  const scan = scanFrontmatter(content);
  if (scan.kind === "none") {
    return { frontmatter: null, body: content };
  }
  if (scan.kind === "unclosed") {
    throw new AfmParseError("Unclosed frontmatter - missing closing '---'");
  }

  const yamlText = content.slice(scan.yamlStart, scan.end);
  const body = content.slice(scan.bodyStart);

  if (yamlText.trim() === "") {
    return { frontmatter: {}, body };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      throw new AfmParseError(`Invalid YAML in frontmatter: ${e.message}`);
    }
    throw e;
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AfmParseError("Frontmatter must be a YAML mapping");
  }

  return { frontmatter: parsed as Record<string, unknown>, body };
}

export interface RoleAndInstructions {
  role: string;
  instructions: string;
}

export function extractRoleAndInstructions(body: string): RoleAndInstructions {
  const lines = body.split(/\r?\n/);

  const roleLines: string[] = [];
  const instructionsLines: string[] = [];
  let current: "role" | "instructions" | null = null;
  let fence: { marker: string; length: number } | null = null;

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) {
        fence = { marker: marker[0]!, length: marker.length };
      } else if (marker[0] === fence.marker && marker.length >= fence.length &&
        /^\s*$/.test(line.slice(line.indexOf(marker) + marker.length))) {
        fence = null;
      }
    }

    const headingLine = marker === undefined && fence === null ? /^ {0,3}#\s+(\S.*?)\s*$/.exec(line) : null;
    if (headingLine !== null) {
      const heading = headingLine[1]!.toLowerCase();
      if (heading === "role") {
        current = "role";
        continue;
      } else if (heading === "instructions") {
        current = "instructions";
        continue;
      } else {
        current = null;
      }
    }

    if (current === "role") {
      roleLines.push(line);
    } else if (current === "instructions") {
      instructionsLines.push(line);
    }
  }

  const role = roleLines.join("\n").trim();
  const instructions = instructionsLines.join("\n").trim();

  if (role === "") {
    throw new AfmParseError("Missing required '# Role' section");
  }
  if (instructions === "") {
    throw new AfmParseError("Missing required '# Instructions' section");
  }

  return { role, instructions };
}

export interface ParsedAfm {
  frontmatter: Record<string, unknown>;
  role: string;
  instructions: string;
}

export function parseAfm(content: string): ParsedAfm {
  const { frontmatter, body } = splitFrontmatter(content);
  const { role, instructions } = extractRoleAndInstructions(body);
  return {
    frontmatter: frontmatter ?? {},
    role,
    instructions,
  };
}
