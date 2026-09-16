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

import type { ReactNode } from "react";
import { Markdown } from "./Markdown";
import { useSpeakText } from "./voice";
import { useCopyFeedback } from "../use-copy-feedback";
import type { UiMessage } from "../chat-state";

type TextMessage = Extract<UiMessage, { kind: "user" | "assistant" }>;

interface Props {
  message: TextMessage;
  streaming: boolean;
  onRegenerate?: () => void;
  /** Footnote for what the answer had to do. */
  footnote?: ReactNode;
}

function Act({ label, path, onClick }: { label: string; path: string; onClick: () => void }) {
  return (
    <button className="xc-act" onClick={onClick} title={label} aria-label={label}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

const COPY = "M9 9h11.5v11.5H9zM5.5 15H4.5A1.5 1.5 0 013 13.5v-9A1.5 1.5 0 014.5 3h9A1.5 1.5 0 0115 4.5v1";
const RETRY = "M3.5 4.5v5h5M4 12a8 8 0 108-8 8 8 0 00-7.4 5";
const SPEAK = "M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7";

/** The person's words get a bubble; the agent's do not. */
export function Message({ message, streaming, onRegenerate, footnote }: Props) {
  const isUser = message.kind === "user";
  const { copied, copy } = useCopyFeedback();
  const voice = useSpeakText();

  const images = message.kind === "user" && message.images !== undefined && message.images.length > 0 && (
    <div className="msg-images">
      {message.images.map((image, index) => (
        <img
          key={`${image.name}-${index}`}
          className="msg-image"
          src={`data:${image.mediaType};base64,${image.data}`}
          alt={image.name}
        />
      ))}
    </div>
  );

  if (isUser) {
    return (
      <div className="xc-turn is-user">
        {images}
        {message.text.trim() !== "" && <div className="xc-user">{message.text}</div>}
      </div>
    );
  }

  return (
    <div className="xc-turn">
      <div className="xc-text">
        <Markdown text={message.text} />
        {streaming && <span className="xc-caret" aria-hidden="true" />}
      </div>
      {(footnote !== undefined || !streaming) && (
        <div className="xc-foot">
          {footnote}
          {!streaming && (
            <span className="xc-acts">
              <Act label={copied ? "Copied" : "Copy"} path={COPY} onClick={() => copy(message.text)} />
              {voice.supported && (
                <Act
                  label={voice.speaking ? "Stop reading aloud" : "Read aloud"}
                  path={SPEAK}
                  onClick={() => (voice.speaking ? voice.stop() : voice.speak(message.text))}
                />
              )}
              {onRegenerate !== undefined && <Act label="Try again" path={RETRY} onClick={onRegenerate} />}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
