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

/** Matches `max-height` on `.composer textarea`; past this the box scrolls. */
export const MAX_COMPOSER_HEIGHT = 180;

/**
 * Height the message box should have, or `null` when there is nothing to measure.
 *
 * The workspace collapses the unused pane to zero width, and a zero-width textarea wraps one
 * character per line, which would pin the height at the cap. Without a width there is no answer.
 */
export function grownHeight(clientWidth: number, scrollHeight: number): number | null {
  if (clientWidth <= 0) return null;
  return Math.min(scrollHeight, MAX_COMPOSER_HEIGHT);
}
