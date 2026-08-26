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

import { useEffect } from "react";

interface Props {
  message: string;
  actionLabel?: string;
  onAction: () => void;
  onDismiss: () => void;
  /** How long the way back stays available. */
  ms?: number;
}

/** Says what happened and offers a way back instead of asking first. */
export function UndoToast({ message, actionLabel = "Undo", onAction, onDismiss, ms = 7000 }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(timer);
  }, [onDismiss, ms]);

  return (
    <div className="u-toast" role="status">
      <span>{message}</span>
      <button onClick={onAction}>{actionLabel}</button>
    </div>
  );
}
