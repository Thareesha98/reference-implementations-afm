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

import { usePasskeySupport } from "../../passkey/usePasskeySupport";
import { useThemeContext } from "../../app/ThemeContext";
import type { useStandaloneSession } from "../../worker-client/useStandaloneSession";
import { usableSecrets } from "../../chat-state";

interface Props {
  session: ReturnType<typeof useStandaloneSession>;
}

/**
 * The keys this browser holds, and the theme. Which tools may run without asking is set on each
 * server's own card.
 */
export function SettingsPanel({ session }: Props) {
  const { setting, setTheme } = useThemeContext();

  const canRemember = usePasskeySupport()?.usable === true;
  // Sealed keys survive a reload, so they show here even when nothing is in memory. Internal OAuth
  // refresh tokens are managed from each server's card, not shown as keys.
  const keys = usableSecrets(session.state).filter((name) => !name.startsWith("afm.oauth."));

  /**
   * Forget means gone: the sealed copy and the value held for this tab. Removing a blob that was
   * never written is a no-op, so one handler covers both kinds of row.
   */
  function forget(name: string): void {
    session.forgetPasskey(name);
    session.removeSecret(name);
  }

  return (
    <div className="u-panel-body">
      <div className="u-group">
        <span className="u-label">Your keys</span>
        {keys.length === 0 ? (
          <p className="u-hint" style={{ marginTop: 0 }}>
            No key yet.
          </p>
        ) : (
          <div className="u-rows">
            {keys.map((name) => {
              const remembered = session.state.passkeySecrets.includes(name);
              return (
                <div className="u-row u-key-row" key={name}>
                  {/* The name gets whatever width is left. */}
                  <span className="u-row-name mono" title={name}>
                    {name}
                  </span>
                  {!remembered && canRemember && (
                    <button
                      className="u-btn quiet sm"
                      onClick={() => void session.rememberWithPasskey(name)}
                    >
                      Remember
                    </button>
                  )}
                  <button className="u-btn quiet sm" onClick={() => forget(name)}>
                    Forget
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="u-group">
        <span className="u-label">Appearance</span>
        <span className="u-seg fill">
          {(["light", "dark", "auto"] as const).map((option) => (
            <button key={option} className={setting === option ? "on" : ""} onClick={() => setTheme(option)}>
              {option === "auto" ? "System" : option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </span>
      </div>

    </div>
  );
}
