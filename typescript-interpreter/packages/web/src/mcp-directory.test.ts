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
import { DIRECTORY_ENTRIES } from "./mcp-directory";

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function duplicates(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

const ids = DIRECTORY_ENTRIES.map((entry) => entry.id);
const signIns = DIRECTORY_ENTRIES.flatMap((entry) => (entry.auth.type === "oauth2" ? [{ id: entry.id, auth: entry.auth }] : []));
const keyed = DIRECTORY_ENTRIES.flatMap((entry) => (entry.auth.type === "bearer" ? [{ id: entry.id, auth: entry.auth }] : []));

describe("the directory", () => {
  it("lists each server once, by id, title and address", () => {
    expect(duplicates(ids)).toEqual([]);
    expect(duplicates(DIRECTORY_ENTRIES.map((entry) => entry.title.toLowerCase()))).toEqual([]);
    expect(duplicates(DIRECTORY_ENTRIES.map((entry) => entry.url))).toEqual([]);
  });

  it("writes every id as a lowercase slug", () => {
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
  });

  it("gives every server a title and a description to read", () => {
    const bare = DIRECTORY_ENTRIES.filter((entry) => entry.title.trim() === "" || entry.description.trim() === "");
    expect(bare.map((entry) => entry.id)).toEqual([]);
  });

  it("names the publisher as a plain domain", () => {
    const odd = DIRECTORY_ENTRIES.filter((entry) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry.publisher));
    expect(odd.map((entry) => entry.id)).toEqual([]);
  });

  it("connects over https and links the page where the publisher documents that address", () => {
    const insecure = DIRECTORY_ENTRIES.filter((entry) => !isHttps(entry.url) || !isHttps(entry.docsUrl));
    expect(insecure.map((entry) => entry.id)).toEqual([]);
  });

  it("has servers that need no sign-in, a key, and a provider sign-in", () => {
    expect(new Set(DIRECTORY_ENTRIES.map((entry) => entry.auth.type))).toEqual(new Set(["none", "bearer", "oauth2"]));
  });
});

describe("a server with provider sign-in", () => {
  it("sends the person only to https addresses", () => {
    const insecure = signIns.filter(
      ({ auth }) => !isHttps(auth.authorizeUrl) || !isHttps(auth.tokenUrl) || (auth.registrationUrl !== undefined && !isHttps(auth.registrationUrl)),
    );
    expect(insecure.map(({ id }) => id)).toEqual([]);
  });

  it("can get a client id without asking the person for one", () => {
    const stuck = signIns.filter(({ auth }) => auth.registrationUrl === undefined && auth.clientIdMetadata !== true);
    expect(stuck.map(({ id }) => id)).toEqual([]);
  });

  it("lists each scope as one word", () => {
    const odd = signIns.filter(({ auth }) => (auth.scopes ?? []).some((scope) => !/^\S+$/.test(scope)));
    expect(odd.map(({ id }) => id)).toEqual([]);
  });

  it("does not list a scope twice", () => {
    const repeated = signIns.filter(({ auth }) => duplicates(auth.scopes ?? []).length > 0);
    expect(repeated.map(({ id }) => id)).toEqual([]);
  });
});

describe("a server that needs a key", () => {
  it("says what the key is", () => {
    expect(keyed.filter(({ auth }) => auth.description.trim() === "").map(({ id }) => id)).toEqual([]);
  });
});
