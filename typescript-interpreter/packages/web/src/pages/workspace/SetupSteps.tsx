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
import { useState } from "react";
import type { SetupStep } from "./readiness";

interface Props {
  steps: SetupStep[];
  currentId: string;
  children: React.ReactNode;
}

export function SetupColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="u-setup">
      <div className="u-setup-col">{children}</div>
    </div>
  );
}

/**
 * A quiet progress line so a multi-step setup does not feel like an interrogation; numbering shows
 * it ends.
 */
export function SetupFrame({ steps, currentId, children }: Props) {
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === currentId),
  );
  return (
    <SetupColumn>
      {steps.length > 1 && (
        <ol className="u-progress">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={i < index ? "done" : i === index ? "current" : ""}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="u-pnum" aria-hidden="true">
                {i < index ? "✓" : i + 1}
              </span>
              <span className="u-progress-label">{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
    </SetupColumn>
  );
}

interface KeyProps {
  name: string;
  onSubmit: (value: string, withPasskey: boolean) => void;
}

/**
 * Asked in the conversation, not in a window over it: providing a key is part of starting the
 * agent.
 */
export function KeyStep({ name, onSubmit }: KeyProps) {
  const [value, setValue] = useState("");
  // Offered only where it can work. Where it cannot, the reason is shown instead of the option
  // going missing.
  const support = usePasskeySupport();

  return (
    <form
      className="u-setup-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "") onSubmit(value, support?.usable === true);
      }}
    >
      <h3 className="u-setup-title">This agent needs a key</h3>
      <p className="u-setup-note">
        <code>{name}</code> reaches the model provider.{" "}
        {support?.usable === true
          ? "Continuing asks for your fingerprint, Face or PIN and keeps the key on this device behind it."
          : "Kept in memory for this tab only — not saved, so you'll re-enter it next time."}
      </p>
      <input
        className="field"
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={name}
        autoFocus
      />
      {support !== null && !support.usable && (
        <p className="u-hint">{support.reason} It is kept for this tab only.</p>
      )}
      <button className="u-btn primary wide" type="submit" disabled={value.trim() === ""}>
        Continue
      </button>
    </form>
  );
}

interface UnlockProps {
  name: string;
  onUnlock: () => void;
  onSkip: () => void;
}

/**
 * Shown when a key was saved behind a passkey on a previous visit. The authenticator answers only
 * under a real click, so this waits for one.
 */
export function UnlockStep({ name, onUnlock, onSkip }: UnlockProps) {
  return (
    <div className="u-setup-card">
      <h3 className="u-setup-title">Unlock your saved key</h3>
      <p className="u-setup-note">
        <code>{name}</code> is saved on this device. Unlock it with your fingerprint, Face or PIN.
      </p>
      <div className="u-panel-foot">
        <button className="u-btn ghost" onClick={onSkip}>
          Type it instead
        </button>
        <button className="u-btn primary" onClick={onUnlock}>
          Unlock
        </button>
      </div>
    </div>
  );
}

interface ApprovalProps {
  name: string;
  hosts: string[];
  onDecide: (approved: boolean) => void;
}

export function ApprovalStep({ name, hosts, onDecide }: ApprovalProps) {
  return (
    <div className="u-setup-card">
      <h3 className="u-setup-title">Send your saved key to this server?</h3>
      <p className="u-setup-note">
        This agent wants to use your saved <code>{name}</code> with:
      </p>
      <ul className="u-rows">
        {hosts.map((host) => (
          <li key={host}>{host}</li>
        ))}
      </ul>
      <div className="u-panel-foot">
        <button className="u-btn ghost" onClick={() => onDecide(false)}>
          Don&apos;t send
        </button>
        <button className="u-btn primary" onClick={() => onDecide(true)}>
          Use my saved key
        </button>
      </div>
    </div>
  );
}

interface SignInProps {
  host: string;
  onSignIn: (remember: boolean) => void;
  onCancel: () => void;
}

export function SignInStep({ host, onSignIn, onCancel }: SignInProps) {
  const support = usePasskeySupport();
  const [remember, setRemember] = useState(false);
  const canRemember = support?.usable === true;
  return (
    <div className="u-setup-card">
      <h3 className="u-setup-title">Sign in with {host}</h3>
      <p className="u-setup-note">
        A pop-up opens {host} and comes back on its own. You sign in on their page; AFM never sees your password.
      </p>
      {canRemember && (
        <label className="u-checkline">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>Remember me on this device</span>
        </label>
      )}
      <div className="u-panel-foot">
        <button className="u-btn ghost" onClick={onCancel}>
          Not now
        </button>
        <button className="u-btn primary" onClick={() => onSignIn(remember && canRemember)}>
          Sign in
        </button>
      </div>
    </div>
  );
}
