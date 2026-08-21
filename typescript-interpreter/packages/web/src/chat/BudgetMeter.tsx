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

import { useEffect, useRef, useState } from "react";
import type { BudgetSnapshot } from "../chat-state";
import { liveElapsedMs } from "./live-elapsed";

interface Props {
  budget: BudgetSnapshot;
  /** True while a turn is in flight; only then does the clock tick. */
  live: boolean;
}

function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

// Sits in the composer's reserved header strip so a change here never moves the message list.
export function BudgetMeter({ budget, live }: Props) {
  const receivedAtRef = useRef(Date.now());
  const [, forceTick] = useState(0);

  // A fresh budget object is a real usage report; it becomes the baseline the clock counts up from.
  useEffect(() => {
    receivedAtRef.current = Date.now();
  }, [budget]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  const elapsedMs = live ? liveElapsedMs(budget.elapsedMs, receivedAtRef.current, Date.now()) : budget.elapsedMs;

  return (
    <span className="budget-meter" title="Steps, tokens and time spent on this turn">
      step {budget.iteration}/{budget.maxIterations} · {formatTokenCount(budget.totalTokens)} tokens ·{" "}
      {Math.round(elapsedMs / 1000)}s
    </span>
  );
}
