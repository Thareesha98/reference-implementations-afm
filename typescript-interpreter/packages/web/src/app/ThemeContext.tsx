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

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadText, saveText } from "../local-json-store";

export type ThemeSetting = "light" | "dark" | "auto";
const THEME_KEY = "afm.theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function initialSetting(): ThemeSetting {
  const stored = loadText(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  return "light";
}

interface ThemeValue {
  setting: ThemeSetting;
  resolved: "light" | "dark";
  setTheme: (setting: ThemeSetting) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<ThemeSetting>(initialSetting);
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = setting === "auto" ? (systemDark ? "dark" : "light") : setting;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
    saveText(THEME_KEY, setting);
  }, [setting, resolved]);

  const value: ThemeValue = {
    setting,
    resolved,
    setTheme: setSetting,
    toggle: () => setSetting(resolved === "dark" ? "light" : "dark"),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useThemeContext must be used within a ThemeProvider");
  }
  return value;
}
