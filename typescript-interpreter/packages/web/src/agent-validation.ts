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

import { parseAfm, agentMetadataSchema, validateMetadata, planForBrowser, splitFrontmatter } from "@afm/engine";
import type { AgentMetadata, Plan } from "@afm/engine";

export type AgentPreview =
  | { ok: true; metadata: AgentMetadata; plan: Plan }
  | { ok: false; error: string };

export function previewAgent(content: string): AgentPreview {
  try {
    const { frontmatter } = parseAfm(content);
    const metadata = validateMetadata(frontmatter);
    const plan = planForBrowser(metadata);
    return { ok: true, metadata, plan };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type BuildableAgent = { ok: true; metadata: AgentMetadata } | { ok: false; error: string };

export function buildableAgent(content: string): BuildableAgent {
  try {
    const { frontmatter } = splitFrontmatter(content);
    return { ok: true, metadata: validateMetadata(frontmatter ?? {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface AfmIssue {
  severity: "error" | "warning";
  message: string;
  field: string;
  line: number | null;
}

interface ZodIssueLike {
  code: string;
  path: (string | number)[];
  message: string;
  keys?: string[];
  received?: unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLine(content: string, key: string | null): number | null {
  if (key === null || key === "") return null;
  const re = new RegExp("^\\s*-?\\s*" + escapeRegExp(key) + "\\s*:");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? "")) return i + 1;
  }
  return null;
}

function lastKeySegment(path: (string | number)[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === "string") return path[i] as string;
  }
  return null;
}

function planPathKey(path: string | undefined): string | null {
  if (path === undefined || path === "") return null;
  const segments = path.match(/[a-zA-Z_]+/g);
  return segments && segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
}

function messageFor(issue: ZodIssueLike, field: string): string {
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return `\`${field}\` is required.`;
  }
  return issue.message;
}

export function collectAfmIssues(content: string): AfmIssue[] {
  const issues: AfmIssue[] = [];

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseAfm(content).frontmatter;
  } catch (error) {
    issues.push({ severity: "error", message: error instanceof Error ? error.message : String(error), field: "", line: null });
    return issues;
  }

  const result = agentMetadataSchema.safeParse(frontmatter);
  if (!result.success) {
    for (const raw of result.error.issues as unknown as ZodIssueLike[]) {
      const field = raw.path.map(String).join(".");
      if (raw.code === "unrecognized_keys" && raw.keys) {
        for (const key of raw.keys) {
          issues.push({
            severity: "error",
            message: `Unknown field '${key}'.`,
            field: [...raw.path.map(String), key].join("."),
            line: findLine(content, key),
          });
        }
      } else {
        issues.push({
          severity: "error",
          message: messageFor(raw, field),
          field,
          line: findLine(content, lastKeySegment(raw.path)),
        });
      }
    }
    return issues;
  }

  const metadata = validateMetadata(frontmatter);
  for (const planIssue of planForBrowser(metadata).issues) {
    issues.push({
      severity: planIssue.severity === "blocked" ? "error" : "warning",
      message: planIssue.message,
      field: planIssue.path ?? "",
      line: findLine(content, planPathKey(planIssue.path)),
    });
  }
  return issues;
}
