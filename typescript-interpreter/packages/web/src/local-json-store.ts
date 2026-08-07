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

/** Lists this browser keeps in localStorage are read and written the same way, shared here. */

/** Reads one stored string; storage that is blocked or unavailable reads as nothing stored. */
export function loadText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reports whether the write landed: storage can refuse it (full or blocked), and pretending
 * otherwise turns "Saved" into a lie.
 */
export function saveText(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Anything unreadable - missing, corrupt, or not an array - counts as empty rather than throwing. */
export function loadJsonArray<T>(key: string): T[] {
  const raw = loadText(key);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    return saveText(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
