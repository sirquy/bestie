import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { resolveLlmCandidate } from "./resolve-config.js";

test("resolveLlmCandidate rejects model refs missing from catalog", () => {
  assert.throws(
    () => resolveLlmCandidate(createConfig(), "openrouter/removed-model"),
    /LLM model ref not found in catalog: openrouter\/removed-model/,
  );
});

function createConfig(): AppConfig {
  return {
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      },
    },
  };
}
