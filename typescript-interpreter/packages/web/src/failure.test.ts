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
import { failureOf, failureFromStatus, MissingCredentialError, SignInRequiredError } from "./failure";

const withCode = (code: number, message = "boom") => Object.assign(new Error(message), { code });

describe("failureOf", () => {
  it("tells a refused credential from a slow server", () => {
    expect(failureOf(withCode(401)).kind).toBe("rejected");
    expect(failureOf(withCode(403)).kind).toBe("rejected");
    expect(failureOf(withCode(-32001, "Request timed out")).kind).toBe("slow");
  });

  it("calls a busy or unreachable server by what it is", () => {
    expect(failureOf(withCode(429)).kind).toBe("busy");
    expect(failureOf(withCode(529)).kind).toBe("busy");
    expect(failureOf(withCode(502)).kind).toBe("unreachable");
  });

  it("tells a server that answers with a redirect from one that cannot be reached", () => {
    const refusal = 'Streamable HTTP error: Error POSTing to endpoint: {"error":"The target answered with a redirect, which is not followed for a request with a body or credentials"}';
    expect(failureOf(withCode(502, refusal))).toEqual({ kind: "redirected", message: refusal });
    expect(failureOf(withCode(502, 'Error POSTing to endpoint: {"error":"Upstream request failed"}')).kind).toBe("unreachable");
    expect(failureOf(withCode(401, refusal)).kind).toBe("rejected");
  });

  it("reads the status of an error that wraps another", () => {
    expect(failureOf(Object.assign(new Error("wrapped"), { cause: withCode(401) })).kind).toBe("rejected");
  });

  it("knows a missing credential and a missing sign-in", () => {
    expect(failureOf(new MissingCredentialError("TOKEN")).kind).toBe("missing");
    expect(failureOf(new SignInRequiredError()).kind).toBe("signin");
  });

  it("reads a request that never arrived as unreachable", () => {
    expect(failureOf(new TypeError("Failed to fetch")).kind).toBe("unreachable");
  });

  it("keeps anything else as other, with its own words", () => {
    expect(failureOf(new TypeError("x is not a function"))).toEqual({ kind: "other", message: "x is not a function" });
    expect(failureOf(new Error("odd"))).toEqual({ kind: "other", message: "odd" });
  });
});

describe("failureFromStatus", () => {
  it("treats no status as unreachable and an unknown one as other", () => {
    expect(failureFromStatus(null)).toBe("unreachable");
    expect(failureFromStatus(418)).toBe("other");
  });
});
