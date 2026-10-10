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

import { createOpenAIModel, createAnthropicModel, checkModelKey } from "@afm/adapter-model";
import type { KeyCheck } from "@afm/adapter-model";
import type { AgentMetadata, ModelPort } from "@afm/engine";
import { MissingCredentialError } from "./failure";

// A blank value is not a key: clearing the Model panel field writes `api_key: ""`, which `??` would
// pass through and send as an empty Authorization header.
function apiKeyOf(model: AgentMetadata["model"]): string | null {
  const auth = model?.authentication;
  const key = auth?.api_key ?? auth?.token ?? null;
  return key === null || key.trim() === "" ? null : key;
}

function unsupported(provider: string): Error {
  return new Error(`Unsupported model provider for the browser: '${provider}'. Use 'openai' or 'anthropic'.`);
}

export async function modelFromMetadata(model: AgentMetadata["model"]): Promise<ModelPort> {
  const provider = (model?.provider ?? "openai").toLowerCase();
  const name = model?.name;
  const apiKey = apiKeyOf(model);

  if (apiKey === null) {
    throw new Error("No API key was provided for the model.");
  }

  switch (provider) {
    case "openai":
      return createOpenAIModel({ apiKey, model: name });
    case "anthropic":
      return createAnthropicModel({ apiKey, model: name });
    default:
      throw unsupported(provider);
  }
}

export async function checkModelFromMetadata(model: AgentMetadata["model"]): Promise<KeyCheck> {
  const provider = (model?.provider ?? "openai").toLowerCase();
  const apiKey = apiKeyOf(model);

  if (apiKey === null) throw new MissingCredentialError("api_key");
  if (provider !== "openai" && provider !== "anthropic") throw unsupported(provider);
  return checkModelKey(provider, apiKey);
}
