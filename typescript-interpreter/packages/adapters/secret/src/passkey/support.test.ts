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

import { afterEach, describe, it, expect, vi } from "vitest";
import { passkeySupport } from "./support";

function browser(options: { secure?: boolean; available?: () => Promise<boolean>; passkeys?: boolean }): void {
  const PublicKeyCredential =
    options.passkeys === false ? undefined : Object.assign(function () {}, { isUserVerifyingPlatformAuthenticatorAvailable: options.available ?? (async () => true) });
  vi.stubGlobal("window", { isSecureContext: options.secure ?? true, PublicKeyCredential });
}

afterEach(() => vi.unstubAllGlobals());

describe("passkeySupport", () => {
  it("is usable when the connection is secure and the device can confirm the person", async () => {
    browser({});
    expect(await passkeySupport()).toEqual({ usable: true });
  });

  it("says passkeys need a secure connection when there is none, or no window at all", async () => {
    const reason = "Passkeys need a secure connection (https, or localhost).";
    browser({ secure: false });
    expect(await passkeySupport()).toEqual({ usable: false, reason });
    vi.unstubAllGlobals();
    expect(await passkeySupport()).toEqual({ usable: false, reason });
  });

  it("says so when the browser has no passkey support", async () => {
    browser({ passkeys: false });
    expect(await passkeySupport()).toEqual({ usable: false, reason: "This browser does not support passkeys." });
  });

  it("says so when the device has no fingerprint, Face or PIN set up", async () => {
    browser({ available: async () => false });
    expect(await passkeySupport()).toEqual({
      usable: false,
      reason: "This device has no fingerprint, Face or PIN unlock set up.",
    });
  });

  it("says so when the browser cannot tell", async () => {
    browser({ available: async () => Promise.reject(new Error("blocked")) });
    expect(await passkeySupport()).toEqual({
      usable: false,
      reason: "This browser could not confirm that passkeys work here.",
    });
  });
});
