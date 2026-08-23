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
import { pickSpeechRecognitionCtor, buildLiveTranscript } from "./voice";
import type { SpeechRecognitionConstructor, SpeechRecognitionResultList } from "./voice";

function resultList(entries: { transcript: string; isFinal: boolean }[]): SpeechRecognitionResultList {
  const list = entries.map((entry) => Object.assign([{ transcript: entry.transcript }], { isFinal: entry.isFinal }));
  return Object.assign(list, { length: list.length }) as unknown as SpeechRecognitionResultList;
}

describe("pickSpeechRecognitionCtor", () => {
  it("prefers the standard constructor over the vendor-prefixed one", () => {
    const standard = {} as SpeechRecognitionConstructor;
    const prefixed = {} as SpeechRecognitionConstructor;
    expect(pickSpeechRecognitionCtor({ SpeechRecognition: standard, webkitSpeechRecognition: prefixed })).toBe(
      standard,
    );
  });

  it("falls back to the vendor-prefixed constructor", () => {
    const prefixed = {} as SpeechRecognitionConstructor;
    expect(pickSpeechRecognitionCtor({ webkitSpeechRecognition: prefixed })).toBe(prefixed);
  });

  it("returns null when the browser has neither - the mic button hides itself", () => {
    expect(pickSpeechRecognitionCtor({})).toBeNull();
  });
});

describe("buildLiveTranscript", () => {
  it("appends the in-progress tail after settled phrases, so partial speech shows live", () => {
    const results = resultList([
      { transcript: "turn the", isFinal: true },
      { transcript: "lights on", isFinal: false },
    ]);
    expect(buildLiveTranscript(results)).toBe("turn the lights on");
  });

  it("joins multiple settled phrases with a space", () => {
    const results = resultList([
      { transcript: "what is", isFinal: true },
      { transcript: "the weather today", isFinal: true },
    ]);
    expect(buildLiveTranscript(results)).toBe("what is the weather today");
  });

  it("returns the tail alone when nothing has settled yet", () => {
    const results = resultList([{ transcript: "still talking", isFinal: false }]);
    expect(buildLiveTranscript(results)).toBe("still talking");
  });

  it("rebuilds from every result each call, not just the newest one - the whole session's text", () => {
    const firstEvent = resultList([{ transcript: "hello", isFinal: true }]);
    const secondEvent = resultList([
      { transcript: "hello", isFinal: true },
      { transcript: "world", isFinal: true },
    ]);
    expect(buildLiveTranscript(firstEvent)).toBe("hello");
    expect(buildLiveTranscript(secondEvent)).toBe("hello world");
  });
});
