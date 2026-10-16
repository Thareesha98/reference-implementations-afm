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
import { describeError } from "@afm/engine";

export type FailureKind = "missing" | "signin" | "rejected" | "slow" | "busy" | "unreachable" | "redirected" | "other";

export interface Failure {
  kind: FailureKind;
  message: string;
}

export class MissingCredentialError extends Error {
  constructor(name: string) {
    super(`Nothing has been entered for '${name}'.`);
    this.name = "MissingCredentialError";
  }
}

export class SignInRequiredError extends Error {
  constructor() {
    super("Interactive sign-in is required for this server.");
    this.name = "SignInRequiredError";
  }
}

const BY_STATUS: Record<number, FailureKind> = {
  401: "rejected",
  403: "rejected",
  408: "slow",
  504: "slow",
  [-32001]: "slow",
  429: "busy",
  500: "busy",
  503: "busy",
  529: "busy",
  502: "unreachable",
};

const NETWORK_FAILURE = /failed to fetch|networkerror|load failed/i;
const PROXY_REDIRECT_REFUSAL = /target answered with a redirect/i;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return typeof code === "number" ? code : statusOf(cause);
}

export function failureFromStatus(status: number | null): FailureKind {
  return status === null ? "unreachable" : (BY_STATUS[status] ?? "other");
}

export function failureOf(error: unknown): Failure {
  const message = describeError(error);
  if (error instanceof MissingCredentialError) return { kind: "missing", message };
  if (error instanceof SignInRequiredError) return { kind: "signin", message };
  if (error instanceof TypeError && NETWORK_FAILURE.test(message)) return { kind: "unreachable", message };
  const status = statusOf(error);
  if (status === 502 && PROXY_REDIRECT_REFUSAL.test(message)) return { kind: "redirected", message };
  return { kind: status === undefined ? "other" : failureFromStatus(status), message };
}
