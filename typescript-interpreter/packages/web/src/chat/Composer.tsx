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
import type { DragEvent, KeyboardEvent } from "react";
import { collectFromDataTransfer, collectFromFileList, supportsDirectoryDrop, pickImages, isSupportedImageFile, IMAGE_ACCEPT, MAX_IMAGES_PER_MESSAGE } from "../attachments";
import type { CollectedFile } from "../attachments";
import type { ImageAttachment } from "../protocol";
import { useVoiceInput } from "./voice";
import { BudgetMeter } from "./BudgetMeter";
import type { BudgetSnapshot } from "../chat-state";
import { grownHeight } from "./composer-size";

export interface AttachOutcome {
  attached: string[];
  skipped: { name: string; reason: string }[];
}

interface Props {
  onSend: (text: string, images?: ImageAttachment[]) => void;
  onStop: () => void;
  onAttach: (files: CollectedFile[]) => Promise<AttachOutcome>;
  streaming: boolean;
  disabled: boolean;
  placeholder?: string;
  seedText?: string;
  seedNonce?: number;
  budget?: BudgetSnapshot | null;
}

function feedbackLine(attached: string[], skipped: number, noun: string): string | null {
  const parts: string[] = [];
  if (attached.length > 0) parts.push(`Attached ${attached.join(", ")}`);
  if (skipped > 0) parts.push(`Skipped ${skipped} ${noun}${skipped === 1 ? "" : "s"}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function Composer({
  onSend,
  onStop,
  onAttach,
  streaming,
  disabled,
  placeholder,
  seedText,
  seedNonce,
  budget,
}: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachAnchorRef = useRef<HTMLDivElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Staged for the turn about to be sent; cleared when it sends.
  const [images, setImages] = useState<ImageAttachment[]>([]);

  useEffect(() => {
    if (seedNonce !== undefined && seedNonce > 0) {
      setText(seedText ?? "");
      ref.current?.focus();
    }
  }, [seedNonce, seedText]);

  // Also grows for text that arrives without a change event, such as a dictated transcript or a
  // seeded draft.
  useEffect(() => {
    if (ref.current) grow(ref.current);
  }, [text]);

  // Measure again once the box has a width; a collapsed pane is 0px wide on first render.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // Our own height change fires this too; only a new width needs measuring.
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      grow(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Text in the box when dictation started; the live transcript replaces what follows it.
  const voiceBaseTextRef = useRef("");

  const voice = useVoiceInput((liveTranscript) => {
    const base = voiceBaseTextRef.current;
    setText(base === "" ? liveTranscript : `${base} ${liveTranscript}`);
  });

  function toggleVoice() {
    if (voice.listening) {
      voice.stop();
      return;
    }
    voiceBaseTextRef.current = text.trim();
    voice.start();
    ref.current?.focus();
  }

  // Close the attach menu on an outside click or Escape.
  useEffect(() => {
    if (!attachMenuOpen) return;

    function onPointerDown(event: PointerEvent) {
      const anchor = attachAnchorRef.current;
      if (anchor !== null && event.target instanceof Node && anchor.contains(event.target)) return;
      setAttachMenuOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setAttachMenuOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    if (feedback === null) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  function submit() {
    const trimmed = text.trim();
    if ((trimmed.length === 0 && images.length === 0) || disabled || streaming) return;
    onSend(trimmed, images.length > 0 ? images : undefined);
    setText("");
    setImages([]);
    if (ref.current) ref.current.style.height = "auto";
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const height = grownHeight(el.clientWidth, el.scrollHeight);
    if (height === null) return;
    el.style.height = `${height}px`;
  }

  async function runAttach(collected: CollectedFile[]) {
    if (collected.length === 0) return;
    setAttaching(true);
    try {
      const outcome = await onAttach(collected);
      setFeedback(feedbackLine(outcome.attached, outcome.skipped.length, "unsupported file"));
    } finally {
      setAttaching(false);
    }
  }

  async function runImagePick(files: File[]) {
    if (files.length === 0) return;
    const { attached, skipped } = await pickImages(files, images.length);
    if (attached.length > 0) setImages((prev) => [...prev, ...attached]);
    const message = feedbackLine(attached.map((image) => image.name), skipped.length, "image");
    if (message !== null) setFeedback(message);
  }

  // Shared by the files and folder inputs; a folder pick is a flat FileList.
  function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (list !== null) void runAttach(collectFromFileList(list).files);
    event.target.value = "";
  }

  function onImagesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (list !== null) void runImagePick(Array.from(list));
    event.target.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const items = event.dataTransfer.items;
    const flatFiles = event.dataTransfer.files;
    if (items !== undefined && items.length > 0 && supportsDirectoryDrop(items)) {
      void collectFromDataTransfer(items).then((result) => {
        void runAttach(result.files.length > 0 ? result.files : collectFromFileList(flatFiles).files);
      });
    } else {
      // A flat drop can mix images and documents; each goes to the pipeline that accepts it.
      const collected = collectFromFileList(flatFiles).files;
      const imageFiles = collected.filter((c) => isSupportedImageFile(c.file));
      const otherFiles = collected.filter((c) => !isSupportedImageFile(c.file));
      if (imageFiles.length > 0) void runImagePick(imageFiles.map((c) => c.file));
      if (otherFiles.length > 0) void runAttach(otherFiles);
    }
  }

  const attachOptions = [
    { label: "Attach files (PDF, MD, TXT)", input: filesInputRef, disabled: false },
    { label: "Attach a folder", input: folderInputRef, disabled: false },
    { label: "Attach an image", input: imagesInputRef, disabled: images.length >= MAX_IMAGES_PER_MESSAGE },
  ];

  return (
    <div
      className={`xc-dock ${budget !== undefined ? "has-meta-row" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {budget !== undefined && (
        <div className="composer-meta-row">
          {budget !== null && <BudgetMeter budget={budget} live={streaming} />}
        </div>
      )}
      {dragOver && (
        <div className="composer-drop-overlay">
          <span>Drop to attach (PDF, Markdown, text, or an image)</span>
        </div>
      )}
      {(attaching || feedback !== null) && (
        <div className="composer-attach-status">{attaching ? "Reading file(s)…" : feedback}</div>
      )}
      {images.length > 0 && (
        <div className="composer-image-row" role="group" aria-label="Attached images">
          {images.map((image, index) => (
            <div className="composer-image-chip" key={`${image.name}-${index}`}>
              <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
              <button
                type="button"
                className="composer-image-remove"
                onClick={() => removeImage(index)}
                aria-label={`Remove ${image.name}`}
                title="Remove this image"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="xc-col"><div className="xc-composer">
        <div className="composer-attach-menu-anchor" ref={attachAnchorRef}>
          <button
            type="button"
            className="xc-cbtn"
            aria-label="Attach files, a folder, or an image"
            title="Attach files, a folder, or an image"
            disabled={disabled}
            onClick={() => setAttachMenuOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95L9.64 18.36a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          {attachMenuOpen && (
            <div className="composer-attach-menu">
              {attachOptions.map(({ label, input, disabled }) => (
                <button
                  type="button"
                  key={label}
                  disabled={disabled}
                  onClick={() => {
                    setAttachMenuOpen(false);
                    input.current?.click();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <input
            ref={filesInputRef}
            type="file"
            multiple
            accept=".pdf,.md,.markdown,.txt"
            className="visually-hidden"
            onChange={onFilesPicked}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory has no React typing
            webkitdirectory=""
            className="visually-hidden"
            onChange={onFilesPicked}
          />
          <input
            ref={imagesInputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="visually-hidden"
            onChange={onImagesPicked}
          />
        </div>
        <textarea
          className="xc-field"
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={
            placeholder ?? (disabled ? "Load an agent first…" : streaming ? "Agent is responding…" : "Message the agent…")
          }
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {voice.supported && (
          <button
            type="button"
            className={`xc-cbtn ${voice.listening ? "listening" : ""}`}
            onClick={toggleVoice}
            disabled={disabled}
            aria-label={voice.listening ? "Stop dictation" : "Dictate a message"}
            title={voice.listening ? "Stop dictation" : "Dictate a message"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
        {streaming ? (
          <button className="xc-stop" onClick={onStop} aria-label="Stop" title="Stop">
            <i aria-hidden="true" />
          </button>
        ) : (
          <button
            className={`xc-send ${disabled || (text.trim().length === 0 && images.length === 0) ? "off" : ""}`}
            onClick={submit}
            disabled={disabled || (text.trim().length === 0 && images.length === 0)}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
            </svg>
          </button>
        )}
      </div></div>
    </div>
  );
}
