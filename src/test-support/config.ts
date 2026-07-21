import type { AppConfig } from "../runtime/config.js";

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config: AppConfig = {
    version: 2,
    agent: {
      name: "Bestie",
      ownerName: "Owner",
      language: "vi",
      timeZone: "Asia/Bangkok",
      toneIntensity: 7,
    },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      },
    },
  };

  return {
    ...config,
    ...overrides,
    agent: { ...config.agent, ...overrides.agent },
    llm: { ...config.llm, ...overrides.llm },
  };
}