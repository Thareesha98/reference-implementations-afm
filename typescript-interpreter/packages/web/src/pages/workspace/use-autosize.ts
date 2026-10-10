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
import { useLayoutEffect, useRef, useState } from "react";
import { grownHeight } from "../../chat/composer-size";

/**
 * Grows a text box with what is typed in it, up to `maxHeight`, past which it scrolls. It measures
 * again when the box changes width, because a window that is still opening is a few pixels wide and
 * wraps its text one character per line.
 */
export function useAutosize(value: string, maxHeight: number) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const field = ref.current;
    if (field === null) return;
    const observer = new ResizeObserver(() => setWidth(field.clientWidth));
    observer.observe(field);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.style.height = "auto";
    const height = grownHeight(field.clientWidth, field.scrollHeight, maxHeight);
    if (height !== null) field.style.height = `${height}px`;
  }, [value, width, maxHeight]);

  return ref;
}
