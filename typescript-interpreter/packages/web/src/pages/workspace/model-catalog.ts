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

// The providers this runtime can build a model port for, with common model names. A convenience,
// not a limit: anything else can be typed by hand.

export interface ModelOption {
  id: string;
  label: string;
  /** What the model card shows; the provider's mark is already there, so the brand is not. */
  short: string;
  /** What it is for. */
  note?: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  host: string;
  // The environment variable this provider's key is conventionally read from.
  secretName: string;
  models: ModelOption[];
}

export const MODEL_PROVIDERS: ProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    host: "api.openai.com",
    secretName: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o", label: "GPT-4o", short: "GPT-4o", note: "general purpose" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", short: "GPT-4o mini", note: "faster, lower cost" },
      { id: "gpt-4.1", label: "GPT-4.1", short: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", short: "GPT-4.1 mini" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    host: "api.anthropic.com",
    secretName: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5", short: "Opus 5", note: "most capable" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", short: "Sonnet 5", note: "balanced" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", short: "Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", short: "Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", short: "Haiku 4.5", note: "fastest" },
    ],
  },
];

export function findProvider(id: string): ProviderOption | undefined {
  return MODEL_PROVIDERS.find((provider) => provider.id === id);
}

/** The short name for a model id, or the id itself when unlisted. */
export function shortModelLabel(modelId: string): string {
  for (const provider of MODEL_PROVIDERS) {
    const found = provider.models.find((model) => model.id === modelId);
    if (found !== undefined) return found.short;
  }
  return modelId;
}
