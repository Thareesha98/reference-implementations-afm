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

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { shouldNotify, notificationContent } from "./turn-notification";
import type { AgentStatus, ChatState } from "../chat-state";
import { loadText, saveText } from "../local-json-store";

const ENABLED_KEY = "afm.notifications";

type NotificationSupport = NotificationPermission | "unsupported";

function isSupported(): boolean {
  return typeof Notification !== "undefined";
}

function initialEnabled(): boolean {
  return isSupported() && Notification.permission === "granted" && loadText(ENABLED_KEY) === "true";
}

function currentPermission(): NotificationSupport {
  return isSupported() ? Notification.permission : "unsupported";
}

interface NotificationsValue {
  enabled: boolean;
  permission: NotificationSupport;
  setEnabled: (value: boolean) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(initialEnabled);
  const [permission, setPermission] = useState<NotificationSupport>(currentPermission);

  async function setEnabled(value: boolean): Promise<void> {
    if (!value) {
      setEnabledState(false);
      saveText(ENABLED_KEY, "false");
      return;
    }
    if (!isSupported()) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    const granted = result === "granted";
    setEnabledState(granted);
    saveText(ENABLED_KEY, String(granted));
  }

  const value: NotificationsValue = { enabled, permission, setEnabled };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

function useNotificationsContext(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (value === null) {
    throw new Error("useNotificationsContext must be used within a NotificationsProvider");
  }
  return value;
}

/** Watches the workspace's session; owns no worker of its own. */
export function TurnNotificationWatcher({ state }: { state: ChatState }) {
  const { enabled, permission } = useNotificationsContext();
  const prevStatusRef = useRef<AgentStatus>(state.status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = state.status;

    if (!shouldNotify(prevStatus, state.status, document.hidden, enabled, permission)) return;

    const { title, body } = notificationContent(state);
    try {
      const notification = new Notification(title, { body });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Some browsers grant permission but refuse the constructor (Android Chrome wants a service
      // worker).
    }
  }, [state.status, enabled, permission]);

  return null;
}
