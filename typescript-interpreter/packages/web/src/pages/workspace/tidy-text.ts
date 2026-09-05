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

/**
 * Turns paragraphs into bullet points and nothing else. It never changes a word, only where the
 * line breaks go, which is why it is safe to press on instructions an agent is following.
 */

/** Abbreviations whose full stop does not end a sentence. */
const NOT_AN_END = /\b(e\.g|i\.e|etc|vs|approx|no|fig|mr|mrs|ms|dr|prof|st|jr|sr)\.$/i;

/** Splits on sentence ends, leaving anything that is not really an end alone. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    current = current === "" ? piece : `${current} ${piece}`;
    // A lone number ("1.") or an abbreviation is a false ending, so keep reading.
    if (!NOT_AN_END.test(current.trim()) && !/(?:^|\s)\d+\.$/.test(current.trim())) {
      out.push(current.trim());
      current = "";
    }
  }
  if (current.trim() !== "") out.push(current.trim());
  return out.filter((entry) => entry !== "");
}

/** Lines that carry their own structure and must be left as they are. */
function isStructured(line: string): boolean {
  return /^\s*(?:[-*]\s+|\d+\.\s+|#{1,6}\s+|>\s?)/.test(line);
}

/**
 * Every ordinary paragraph becomes one bullet per sentence; headings, quotes and lists pass through
 * untouched.
 */
export function tidyIntoBullets(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const out = blocks.map((block) => {
    const lines = block.split("\n");
    if (lines.some(isStructured)) return block;

    const paragraph = lines.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph === "") return block;

    const parts = sentences(paragraph);
    // A single sentence is not a list.
    if (parts.length < 2) return paragraph;
    return parts.map((part) => `- ${part}`).join("\n");
  });
  return out.join("\n\n").trim();
}

/** Whether pressing the button would change anything. */
export function canTidy(markdown: string): boolean {
  return tidyIntoBullets(markdown) !== markdown.trim();
}
