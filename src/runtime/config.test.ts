import assert from "node:assert/strict";
import test from "node:test";

import { InvalidConfigError } from "./errors.js";
import { validateConfig } from "./config.js";

const validConfig = {
  version: 2,
  agent: {
    name: "Miu",
    ownerName: "Sep",
    language: "vi",
    toneIntensity: 7,
  },
  llm: {
    primary: "openai/example-model",
    authProfile: "openai:api-key",
    profiles: {
      "openai:api-key": {
        provider: "openai-compatible",
        mode: "api-key" as const,
        baseUrl: "https://example.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      },
    },
    modelCatalog: {
      "openai/example-model": { profile: "openai:api-key" },
    },
  },
};

test("validateConfig accepts the Phase Now config shape", () => {
  const config = validateConfig({
    version: 2,
    agent: {
      name: "Miu",
      ownerName: "Sếp",
      language: "vi",
      toneIntensity: 7,
    },
    llm: { ...validConfig.llm, timeoutMs: 90_000 },
  });

  assert.equal(config.llm.profiles["openai:api-key"]?.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(config.llm.timeoutMs, 90_000);
  assert.equal(typeof config.agent.timeZone, "string");
});

test("validateConfig accepts and validates agent.timeZone", () => {
  const config = validateConfig({
    ...validConfig,
    agent: { ...validConfig.agent, timeZone: "Asia/Ho_Chi_Minh" },
  });

  assert.equal(config.agent.timeZone, "Asia/Ho_Chi_Minh");
  assert.throws(
    () => validateConfig({ ...validConfig, agent: { ...validConfig.agent, timeZone: "Moon/Base" } }),
    InvalidConfigError,
  );
});


test("validateConfig accepts Gemini CLI local provider without baseUrl or apiKeyEnv", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      primary: "gemini-cli/default",
      authProfile: "gemini-cli:local",
      profiles: {
        "gemini-cli:local": { provider: "gemini-cli", mode: "local" },
      },
      modelCatalog: {
        "gemini-cli/default": { profile: "gemini-cli:local" },
      },
    },
  });

  assert.equal(config.llm.profiles["gemini-cli:local"]?.provider, "gemini-cli");
  assert.equal(config.llm.profiles["gemini-cli:local"]?.baseUrl, undefined);
  assert.equal(config.llm.profiles["gemini-cli:local"]?.apiKeyEnv, undefined);
});

test("validateConfig accepts Claude CLI local provider without baseUrl or apiKeyEnv", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      primary: "claude-cli/default",
      authProfile: "claude-cli:local",
      profiles: {
        "claude-cli:local": { provider: "claude-cli", mode: "local" },
      },
      modelCatalog: {
        "claude-cli/default": { profile: "claude-cli:local" },
      },
    },
  });

  assert.equal(config.llm.profiles["claude-cli:local"]?.provider, "claude-cli");
  assert.equal(config.llm.profiles["claude-cli:local"]?.baseUrl, undefined);
  assert.equal(config.llm.profiles["claude-cli:local"]?.apiKeyEnv, undefined);
});

test("validateConfig accepts Codex CLI local provider without baseUrl or apiKeyEnv", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      primary: "codex-cli/default",
      authProfile: "codex-cli:local",
      profiles: {
        "codex-cli:local": { provider: "codex-cli", mode: "local" },
      },
      modelCatalog: {
        "codex-cli/default": { profile: "codex-cli:local" },
      },
    },
  });

  assert.equal(config.llm.profiles["codex-cli:local"]?.provider, "codex-cli");
  assert.equal(config.llm.profiles["codex-cli:local"]?.baseUrl, undefined);
  assert.equal(config.llm.profiles["codex-cli:local"]?.apiKeyEnv, undefined);
});

test("validateConfig still requires baseUrl for OpenAI-compatible local providers", () => {
  assert.throws(
    () => validateConfig({
      ...validConfig,
      llm: {
        primary: "ollama/llama3.1",
        authProfile: "ollama:local",
        profiles: {
          "ollama:local": { provider: "openai-compatible", mode: "local" },
        },
        modelCatalog: {
          "ollama/llama3.1": { profile: "ollama:local" },
        },
      },
    }),
    /baseUrl is required/,
  );
});

test("validateConfig keeps llm.timeoutMs optional for existing configs", () => {
  const config = validateConfig({
    version: 2,
    agent: {
      name: "Miu",
      ownerName: "Sep",
      language: "vi",
      toneIntensity: 7,
    },
    llm: validConfig.llm,
  });

  assert.equal(config.llm.timeoutMs, undefined);
});

test("validateConfig accepts optional Agent Workforce profiles", () => {
  const config = validateConfig({
    ...validConfig,
    agents: {
      researcher: {
        enabled: true,
        displayName: "Mika",
        role: "Research Assistant",
        description: "Research and summarize information.",
        promptPath: "/tmp/.bestie/agents/researcher/system-prompt.md",
        model: "openai/example-model",
        tools: ["internal.read_file"],
        memoryScope: "agent:researcher",
        approvalPolicy: "ask-for-external-actions",
      },
    },
  });

  assert.equal(config.agents?.researcher?.displayName, "Mika");
  assert.equal(config.agents?.researcher?.memoryScope, "agent:researcher");
});

test("validateConfig accepts optional skill remote registry contract", () => {
  const config = validateConfig({
    ...validConfig,
    skills: {
      registry: {
        remoteOfficial: {
          enabled: true,
          url: "https://skills.example.test/registry.json",
          checksumUrl: "https://skills.example.test/registry.sha256",
          publicKey: "test-public-key",
          signatureHeader: "x-bestie-signature",
          timeoutMs: 5000,
          installPolicy: "ask",
        },
      },
    },
  });

  assert.equal(config.skills?.registry?.remoteOfficial?.enabled, true);
  assert.equal(config.skills?.registry?.remoteOfficial?.url, "https://skills.example.test/registry.json");
  assert.equal(config.skills?.registry?.remoteOfficial?.checksumUrl, "https://skills.example.test/registry.sha256");
  assert.equal(config.skills?.registry?.remoteOfficial?.publicKey, "test-public-key");
  assert.equal(config.skills?.registry?.remoteOfficial?.signatureHeader, "x-bestie-signature");
  assert.equal(config.skills?.registry?.remoteOfficial?.timeoutMs, 5000);
  assert.equal(config.skills?.registry?.remoteOfficial?.installPolicy, "ask");
});

test("validateConfig rejects non-https skill remote registry checksum URLs", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, skills: { registry: { remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "http://skills.example.test/registry.sha256" } } } }),
    /skills\.registry\.remoteOfficial\.checksumUrl must use https:\/\/\./,
  );
});

test("validateConfig rejects non-https skill remote registry URLs", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, skills: { registry: { remoteOfficial: { enabled: true, url: "http://skills.example.test/registry.json" } } } }),
    /skills\.registry\.remoteOfficial\.url must use https:\/\/\./,
  );
});

test("validateConfig rejects invalid skill remote install policy", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, skills: { registry: { remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", installPolicy: "allow" } } } }),
    /skills\.registry\.remoteOfficial\.installPolicy must be deny or ask/,
  );
});

test("validateConfig accepts optional llm retry settings", () => {
  const config = validateConfig({
    ...validConfig,
    llm: { ...validConfig.llm, maxRetries: 2, retryDelayMs: 0 },
  });

  assert.equal(config.llm.maxRetries, 2);
  assert.equal(config.llm.retryDelayMs, 0);
});

test("validateConfig allows Gemini profiles without baseUrl", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      primary: "gemini/gemini-2.5-flash",
      authProfile: "gemini:api-key",
      profiles: {
        "gemini:api-key": {
          provider: "gemini",
          mode: "api-key",
          apiKeyEnv: "GEMINI_API_KEY",
        },
      },
      modelCatalog: {
        "gemini/gemini-2.5-flash": { profile: "gemini:api-key" },
      },
    },
  });

  assert.equal(config.llm.profiles["gemini:api-key"]?.baseUrl, undefined);
});

test("validateConfig requires baseUrl for HTTP LLM profiles", () => {
  assert.throws(
    () => validateConfig({
      ...validConfig,
      llm: {
        ...validConfig.llm,
        profiles: {
          "openai:api-key": {
            provider: "openai-compatible",
            mode: "api-key",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
      },
    }),
    /baseUrl is required/,
  );
});

test("validateConfig accepts optional LLM fallback model refs", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      ...validConfig.llm,
      fallbacks: ["anthropic/claude-sonnet-4-5"],
    },
  });

  assert.deepEqual(config.llm.fallbacks, ["anthropic/claude-sonnet-4-5"]);
});

test("validateConfig accepts optional OpenAI-compatible transcription provider", () => {
  const config = validateConfig({
    ...validConfig,
    transcription: {
      provider: "openai-compatible",
      baseUrl: "https://audio.example.com/v1",
      model: "whisper-1",
      apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY",
      timeoutMs: 45_000,
    },
  });

  assert.deepEqual(config.transcription, {
    provider: "openai-compatible",
    baseUrl: "https://audio.example.com/v1",
    model: "whisper-1",
    apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY",
    timeoutMs: 45_000,
  });
});

test("validateConfig accepts optional local whisper transcription provider", () => {
  const config = validateConfig({
    ...validConfig,
    transcription: {
      provider: "local-whisper",
      command: "whisper-cli",
      args: ["-m", "{modelPath}", "-f", "{audioPath}", "-nt"],
      modelPath: ".bestie/models/ggml-small.bin",
      timeoutMs: 120_000,
    },
  });

  assert.deepEqual(config.transcription, {
    provider: "local-whisper",
    command: "whisper-cli",
    args: ["-m", "{modelPath}", "-f", "{audioPath}", "-nt"],
    modelPath: ".bestie/models/ggml-small.bin",
    timeoutMs: 120_000,
  });
});

test("validateConfig accepts optional ElevenLabs transcription provider", () => {
  const config = validateConfig({
    ...validConfig,
    transcription: {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      modelId: "scribe_v2",
      languageCode: "vi",
      tagAudioEvents: true,
      diarize: false,
      timeoutMs: 120_000,
    },
  });

  assert.deepEqual(config.transcription, {
    provider: "elevenlabs",
    apiKeyEnv: "ELEVENLABS_API_KEY",
    modelId: "scribe_v2",
    languageCode: "vi",
    tagAudioEvents: true,
    diarize: false,
    timeoutMs: 120_000,
  });
});

test("validateConfig accepts optional Voicebox transcription provider", () => {
  const config = validateConfig({
    ...validConfig,
    transcription: {
      provider: "voicebox",
      baseUrl: "http://127.0.0.1:17493/",
      model: "turbo",
      language: "en",
      clientId: "bestie",
      timeoutMs: 120_000,
    },
  });

  assert.deepEqual(config.transcription, {
    provider: "voicebox",
    baseUrl: "http://127.0.0.1:17493",
    model: "turbo",
    language: "en",
    clientId: "bestie",
    timeoutMs: 120_000,
  });
});

test("validateConfig accepts optional transcription fallbacks", () => {
  const config = validateConfig({
    ...validConfig,
    transcription: {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      modelId: "scribe_v2",
      fallbacks: [
        { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" },
        { provider: "local-whisper", command: "whisper-cli", args: ["-m", "{modelPath}", "-f", "{audioPath}"], modelPath: ".bestie/models/ggml-small.bin" },
      ],
    },
  });

  assert.deepEqual(config.transcription?.fallbacks, [
    { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" },
    { provider: "local-whisper", command: "whisper-cli", args: ["-m", "{modelPath}", "-f", "{audioPath}"], modelPath: ".bestie/models/ggml-small.bin" },
  ]);
});

test("validateConfig accepts optional OpenAI-compatible speech provider", () => {
  const config = validateConfig({
    ...validConfig,
    speech: {
      provider: "openai-compatible",
      baseUrl: "http://localhost:20128/v1",
      model: "google-tts/vi",
      apiKeyEnv: "BESTIE_TTS_API_KEY",
      responseFormat: "mp3",
      timeoutMs: 45_000,
    },
  });

  assert.deepEqual(config.speech, {
    provider: "openai-compatible",
    baseUrl: "http://localhost:20128/v1",
    model: "google-tts/vi",
    apiKeyEnv: "BESTIE_TTS_API_KEY",
    responseFormat: "mp3",
    timeoutMs: 45_000,
  });
});

test("validateConfig accepts optional ElevenLabs speech provider", () => {
  const config = validateConfig({
    ...validConfig,
    speech: {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      voiceId: "NOpBlnGInO9m6vDvFkFC",
      modelId: "eleven_v3",
      outputFormat: "mp3_44100_128",
      timeoutMs: 45_000,
    },
  });

  assert.deepEqual(config.speech, {
    provider: "elevenlabs",
    apiKeyEnv: "ELEVENLABS_API_KEY",
    voiceId: "NOpBlnGInO9m6vDvFkFC",
    modelId: "eleven_v3",
    outputFormat: "mp3_44100_128",
    timeoutMs: 45_000,
  });
});

test("validateConfig accepts optional Voicebox speech provider", () => {
  const config = validateConfig({
    ...validConfig,
    speech: {
      provider: "voicebox",
      baseUrl: "http://127.0.0.1:17493/",
      profile: "Morgan",
      engine: "qwen",
      language: "en",
      clientId: "bestie",
      personality: true,
      pollIntervalMs: 1_000,
      timeoutMs: 180_000,
    },
  });

  assert.deepEqual(config.speech, {
    provider: "voicebox",
    baseUrl: "http://127.0.0.1:17493",
    profile: "Morgan",
    engine: "qwen",
    language: "en",
    clientId: "bestie",
    personality: true,
    pollIntervalMs: 1_000,
    timeoutMs: 180_000,
  });
});

test("validateConfig accepts optional media generation providers", () => {
  const config = validateConfig({
    ...validConfig,
    llm: {
      ...validConfig.llm,
      image: {
        primary: "openai/image-primary",
        fallbacks: ["custom-openai/image-fallback"],
      },
      modelCatalog: {
        ...validConfig.llm.modelCatalog,
        "openai/image-primary": { profile: "openai:api-key" },
        "custom-openai/image-fallback": { profile: "openai:api-key" },
      },
    },
    generation: {
      image: {
        endpointPath: "/custom/images",
        timeoutMs: 90_000,
      },
      video: {
        provider: "openai-compatible",
        baseUrl: "https://media.example.com/v1",
        model: "video-model",
        apiKeyEnv: "BESTIE_VIDEO_API_KEY",
        endpointPath: "/custom/videos",
      },
    },
  });

  assert.deepEqual(config.generation?.image, {
    endpointPath: "/custom/images",
    timeoutMs: 90_000,
  });
  assert.deepEqual(config.llm.image, { primary: "openai/image-primary", fallbacks: ["custom-openai/image-fallback"] });
  assert.equal(config.generation?.video?.endpointPath, "/custom/videos");
});

test("validateConfig accepts optional speech fallbacks", () => {
  const config = validateConfig({
    ...validConfig,
    speech: {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      voiceId: "NOpBlnGInO9m6vDvFkFC",
      fallbacks: [
        { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY", responseFormat: "mp3" },
      ],
    },
  });

  assert.deepEqual(config.speech?.fallbacks, [
    { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY", responseFormat: "mp3" },
  ]);
});

test("validateConfig accepts optional Telegram channel config", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      telegram: {
        enabled: true,
        botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN",
        ownerUserId: "12345",
        voiceReplyMaxChars: 700,
        voiceReplyCooldownMs: 10_000,
      },
    },
  });

  assert.equal(config.channels?.telegram?.enabled, true);
  assert.equal(config.channels?.telegram?.botTokenEnv, "BESTIE_TELEGRAM_BOT_TOKEN");
  assert.equal(config.channels?.telegram?.ownerUserId, "12345");
  assert.equal(config.channels?.telegram?.voiceReplyMaxChars, 700);
  assert.equal(config.channels?.telegram?.voiceReplyCooldownMs, 10_000);
});

test("validateConfig accepts optional Zalo channel config", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      zalo: {
        enabled: true,
        botTokenEnv: "BESTIE_ZALO_BOT_TOKEN",
        ownerUserId: "zalo-owner-1",
        pollingTimeoutSeconds: 20,
      },
    },
  });

  assert.equal(config.channels?.zalo?.enabled, true);
  assert.equal(config.channels?.zalo?.botTokenEnv, "BESTIE_ZALO_BOT_TOKEN");
  assert.equal(config.channels?.zalo?.ownerUserId, "zalo-owner-1");
  assert.equal(config.channels?.zalo?.pollingTimeoutSeconds, 20);
});

test("validateConfig accepts optional Telegram attachment policy", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      telegram: {
        enabled: true,
        botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN",
        ownerUserId: "12345",
        attachments: {
          downloadPolicy: "allow",
          maxBytes: 1024,
          previewMaxBytes: 128,
          parseMaxBytes: 512,
          visionPolicy: "allow",
          visionMaxBytes: 256,
          transcriptionPolicy: "allow",
          transcriptionMaxBytes: 768,
          deleteAfterProcessingKinds: ["voice", "audio"],
          allowedMimeTypes: ["text/*", "application/json"],
        },
      },
    },
  });

  assert.deepEqual(config.channels?.telegram?.attachments, {
    downloadPolicy: "allow",
    maxBytes: 1024,
    previewMaxBytes: 128,
    parseMaxBytes: 512,
    visionPolicy: "allow",
    visionMaxBytes: 256,
    transcriptionPolicy: "allow",
    transcriptionMaxBytes: 768,
    deleteAfterProcessingKinds: ["voice", "audio"],
    allowedMimeTypes: ["text/*", "application/json"],
  });
});

test("validateConfig accepts optional memory policies", () => {
  const config = validateConfig({ ...validConfig, memory: { writePolicy: "ask", deletePolicy: "deny", retrievalPolicy: "governed", recentMessageLimit: 180 } });

  assert.deepEqual(config.memory, { writePolicy: "ask", deletePolicy: "deny", retrievalPolicy: "governed", recentMessageLimit: 180 });
});

test("validateConfig accepts optional workspace config", () => {
  const config = validateConfig({ ...validConfig, workspace: { defaultPath: ".bestie/workspace", externalPaths: ["../shared", { path: "/tmp/bestie-shared", access: "read" }, { path: "/tmp/bestie-output", access: "write" }] } });

  assert.deepEqual(config.workspace, { defaultPath: ".bestie/workspace", externalPaths: ["../shared", { path: "/tmp/bestie-shared", access: "read" }, { path: "/tmp/bestie-output", access: "write" }] });
});

test("validateConfig accepts optional internal tool policies", () => {
  const config = validateConfig({ ...validConfig, internalTools: { policies: { "internal.exec": "ask", "internal.write_file": "deny" }, exec: { timeoutMs: 120_000 }, browser: { cdpEndpoint: "http://127.0.0.1:9222" } } });

  assert.deepEqual(config.internalTools, { policies: { "internal.exec": "ask", "internal.write_file": "deny" }, exec: { timeoutMs: 120_000 }, browser: { cdpEndpoint: "http://127.0.0.1:9222" } });
});

test("validateConfig accepts optional MCP server config", () => {
  const config = validateConfig({
    ...validConfig,
    mcp: {
      servers: [
        {
          name: "filesystem",
          enabled: false,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { MCP_LOG_LEVEL: "warn" },
          tools: [{ name: "read_file", category: "read" }],
        },
      ],
    },
  });

  assert.equal(config.mcp?.servers[0].name, "filesystem");
  assert.equal(config.mcp?.servers[0].enabled, false);
  assert.deepEqual(config.mcp?.servers[0].args, ["-y", "@modelcontextprotocol/server-filesystem"]);
  assert.deepEqual(config.mcp?.servers[0].tools, [{ name: "read_file", category: "read" }]);
});

test("validateConfig accepts remote HTTP MCP server config with secret headers mapped from env", () => {
  const config = validateConfig({
    ...validConfig,
    mcp: {
      servers: [
        {
          name: "composio",
          enabled: true,
          transport: "http",
          url: "https://connect.composio.dev/mcp",
          headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" },
          tools: [{ name: "lookup", category: "read" }],
        },
      ],
    },
  });

  assert.equal(config.mcp?.servers[0].transport, "http");
  assert.equal(config.mcp?.servers[0].url, "https://connect.composio.dev/mcp");
  assert.deepEqual(config.mcp?.servers[0].headersEnv, { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" });
});

test("validateConfig normalizes top-level mcpServers into remote MCP config", () => {
  const config = validateConfig({
    ...validConfig,
    mcpServers: {
      composio: {
        url: "https://connect.composio.dev/mcp",
        headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" },
      },
    },
  });

  assert.equal(config.mcp?.servers[0].name, "composio");
  assert.equal(config.mcp?.servers[0].enabled, true);
  assert.equal(config.mcp?.servers[0].transport, "http");
  assert.equal(config.mcp?.servers[0].url, "https://connect.composio.dev/mcp");
  assert.deepEqual(config.mcp?.servers[0].headersEnv, { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" });
});

test("validateConfig accepts disabled Telegram channel without owner user id", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      telegram: {
        enabled: false,
        botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN",
        ownerUserId: "",
      },
    },
  });

  assert.equal(config.channels?.telegram?.enabled, false);
  assert.equal(config.channels?.telegram?.ownerUserId, "");
});

test("validateConfig rejects invalid llm.timeoutMs", () => {
  assert.throws(
    () =>
      validateConfig({
        version: 2,
        agent: {
          name: "Miu",
          ownerName: "Sep",
          language: "vi",
          toneIntensity: 7,
        },
        llm: {
          provider: "openai-compatible",
          baseUrl: "https://example.com/v1",
          model: "example-model",
          apiKeyEnv: "OPENAI_API_KEY",
          timeoutMs: 0,
        },
      }),
    InvalidConfigError,
  );
});

test("validateConfig rejects invalid llm retry settings", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, llm: { ...validConfig.llm, maxRetries: -1 } }),
    /llm.maxRetries must be a non-negative integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, llm: { ...validConfig.llm, retryDelayMs: 1.5 } }),
    /llm.retryDelayMs must be a non-negative integer/,
  );
});

test("validateConfig rejects invalid transcription provider config", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "local", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" } }),
    /transcription.provider must be openai-compatible, elevenlabs, local-whisper, or voicebox/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "openai-compatible", baseUrl: "", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" } }),
    /transcription.baseUrl must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" } }),
    /transcription.model must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "" } }),
    /transcription.apiKeyEnv must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY", timeoutMs: 0 } }),
    /transcription.timeoutMs must be a positive integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "local-whisper", command: "", modelPath: ".bestie/models/ggml-small.bin" } }),
    /transcription.command must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "local-whisper", command: "whisper-cli", args: ["-m", "{modelPath}"], modelPath: ".bestie/models/ggml-small.bin" } }),
    /transcription.args must include \{audioPath\}/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "local-whisper", command: "whisper-cli", args: ["-f", 1], modelPath: ".bestie/models/ggml-small.bin" } }),
    /transcription.args must be an array of non-empty strings/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, transcription: { provider: "local-whisper", command: "whisper-cli", modelPath: "" } }),
    /transcription.modelPath must be a non-empty string/,
  );
});

test("validateConfig rejects invalid speech provider config", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "local", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" } }),
    /speech.provider must be openai-compatible, elevenlabs, voicebox, or local-command/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", voiceId: "" } }),
    /speech.voiceId must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "openai-compatible", baseUrl: "", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" } }),
    /speech.baseUrl must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "", apiKeyEnv: "BESTIE_TTS_API_KEY" } }),
    /speech.model must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "" } }),
    /speech.apiKeyEnv must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY", responseFormat: "mp4" } }),
    /speech.responseFormat must be mp3, opus, aac, flac, wav, or pcm/,
  );
});

test("validateConfig rejects invalid Telegram channel config", () => {
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: "yes", botTokenEnv: "BOT_TOKEN", ownerUserId: "12345" } } }),
    /channels.telegram.enabled must be a boolean/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "", ownerUserId: "12345" } } }),
    /channels.telegram.botTokenEnv must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", voiceReplyPolicy: "always" } } }),
    /channels.telegram.voiceReplyPolicy must be deny or voice-input-only/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { downloadPolicy: "ask" } } } }),
    /channels.telegram.attachments.downloadPolicy must be allow or deny/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { maxBytes: 0 } } } }),
    /channels.telegram.attachments.maxBytes must be a positive integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { parseMaxBytes: 0 } } } }),
    /channels.telegram.attachments.parseMaxBytes must be a positive integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { visionPolicy: "ask" } } } }),
    /channels.telegram.attachments.visionPolicy must be allow or deny/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { visionMaxBytes: 0 } } } }),
    /channels.telegram.attachments.visionMaxBytes must be a positive integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "ask" } } } }),
    /channels.telegram.attachments.transcriptionPolicy must be allow or deny/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionMaxBytes: 0 } } } }),
    /channels.telegram.attachments.transcriptionMaxBytes must be a positive integer/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { allowedMimeTypes: [""] } } } }),
    /channels.telegram.attachments.allowedMimeTypes must be an array of non-empty strings/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "BOT_TOKEN", ownerUserId: "12345", attachments: { deleteAfterProcessingKinds: ["voice", "unknown"] } } } }),
    /channels.telegram.attachments.deleteAfterProcessingKinds must be an array of Telegram attachment kinds/,
  );
});

test("validateConfig rejects invalid memory write policy", () => {
  assert.throws(() => validateConfig({ ...validConfig, memory: { writePolicy: "sometimes" } }), /memory.writePolicy must be allow, ask, or deny/);
  assert.throws(() => validateConfig({ ...validConfig, memory: { deletePolicy: "sometimes" } }), /memory.deletePolicy must be allow, ask, or deny/);
  assert.throws(() => validateConfig({ ...validConfig, memory: { retrievalPolicy: "sometimes" } }), /memory.retrievalPolicy must be full or governed/);
  assert.throws(() => validateConfig({ ...validConfig, memory: { recentMessageLimit: 0 } }), /memory.recentMessageLimit must be a positive integer/);
});

test("validateConfig rejects invalid workspace config", () => {
  assert.throws(() => validateConfig({ ...validConfig, workspace: { defaultPath: "" } }), /workspace.defaultPath must be a non-empty string/);
  assert.throws(() => validateConfig({ ...validConfig, workspace: { externalPaths: ["ok", ""] } }), /workspace.externalPaths must be an array of non-empty strings or objects/);
  assert.throws(() => validateConfig({ ...validConfig, workspace: { externalPaths: [{ path: "ok", access: "execute" }] } }), /workspace.externalPaths must be an array of non-empty strings or objects/);
});

test("validateConfig rejects invalid internal tool policies", () => {
  assert.throws(() => validateConfig({ ...validConfig, internalTools: { policies: [] } }), /internalTools.policies must be an object/);
  assert.throws(() => validateConfig({ ...validConfig, internalTools: { policies: { "internal.exec": "sometimes" } } }), /internalTools.policies.internal.exec must be allow, ask, or deny/);
  assert.throws(() => validateConfig({ ...validConfig, internalTools: { exec: { timeoutMs: 0 } } }), /internalTools.exec.timeoutMs must be a positive integer/);
  assert.throws(() => validateConfig({ ...validConfig, internalTools: { browser: { cdpEndpoint: "http://example.com:9222" } } }), /browser.cdpEndpoint must be an http\(s\) or ws\(s\) loopback URL/);
  assert.throws(() => validateConfig({ ...validConfig, internalTools: { browser: { cdpEndpoint: "http://token@127.0.0.1:9222" } } }), /browser.cdpEndpoint must be an http\(s\) or ws\(s\) loopback URL/);
});

test("validateConfig accepts a local command speech provider", () => {
  const config = validateConfig({
    ...validConfig,
    speech: {
      provider: "local-command",
      command: "C:\\Python314\\python.exe",
      args: ["-m", "piper", "--model", "{modelPath}", "--output_file", "{outputPath}"],
      modelPath: ".bestie/models/piper/vi_VN-vais1000-medium.onnx",
      env: { PYTHONPATH: "C:\\Users\\example\\.bestie\\tools\\piper" },
      outputFormat: "wav",
      timeoutMs: 120_000,
    },
  });

  assert.deepEqual(config.speech, {
    provider: "local-command",
    command: "C:\\Python314\\python.exe",
    args: ["-m", "piper", "--model", "{modelPath}", "--output_file", "{outputPath}"],
    modelPath: ".bestie/models/piper/vi_VN-vais1000-medium.onnx",
    env: { PYTHONPATH: "C:\\Users\\example\\.bestie\\tools\\piper" },
    outputFormat: "wav",
    timeoutMs: 120_000,
  });
});

test("validateConfig accepts Zalo Personal media settings and requires a controller when enabled", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      zaloPersonal: {
        enabled: true,
        sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION",
        ownerUserId: "controller-1",
        reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000 },
        attachments: { downloadPolicy: "allow", maxBytes: 4_096, visionPolicy: "allow" },
      },
    },
  });

  assert.deepEqual(config.channels?.zaloPersonal, {
    enabled: true,
    sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION",
    ownerUserId: "controller-1",
    reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000 },
    attachments: { downloadPolicy: "allow", maxBytes: 4_096, visionPolicy: "allow" },
  });
  assert.throws(
    () => validateConfig({ ...validConfig, channels: { zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "" } } }),
    /ownerUserId must be set/,
  );
});

test("validateConfig accepts multiple channel owners and a wildcard", () => {
  const config = validateConfig({
    ...validConfig,
    channels: {
      telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: [" owner-1 ", "owner-2"] },
      zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: ["*"] },
      zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: ["controller-1", "controller-2"] },
    },
  });

  assert.deepEqual(config.channels?.telegram?.ownerUserId, ["owner-1", "owner-2"]);
  assert.deepEqual(config.channels?.zalo?.ownerUserId, ["*"]);
  assert.deepEqual(config.channels?.zaloPersonal?.ownerUserId, ["controller-1", "controller-2"]);
  assert.throws(() => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "TOKEN", ownerUserId: [] } } }), /non-empty array/);
  assert.throws(() => validateConfig({ ...validConfig, channels: { telegram: { enabled: true, botTokenEnv: "TOKEN", ownerUserId: ["*", "owner-1"] } } }), /single array value/);
});

test("validateConfig rejects invalid MCP server config", () => {
  assert.throws(() => validateConfig({ ...validConfig, mcp: { servers: "nope" } }), /mcp.servers must be an array/);
  assert.throws(
    () => validateConfig({ ...validConfig, mcp: { servers: [{ name: "fs", enabled: "yes", command: "node" }] } }),
    /mcp.servers\[0].enabled must be a boolean/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, mcp: { servers: [{ name: "fs", enabled: true, command: "node", args: ["ok", 1] }] } }),
    /mcp.servers\[0].args must be an array of strings/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "teleport" }] }] } }),
    /mcp.servers\[0].tools\[0].category must be/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, mcp: { servers: [{ name: "remote", enabled: true, transport: "http", url: "ftp://example.com/mcp" }] } }),
    /mcp.servers\[0].url must be an HTTP\(S\) URL/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, mcp: { servers: [{ name: "remote", enabled: true, transport: "http", url: "https://example.com/mcp", headers: { "x-consumer-api-key": "raw-secret" } }] } }),
    /headers.x-consumer-api-key must be configured through headersEnv/,
  );
  assert.throws(
    () => validateConfig({ ...validConfig, mcpServers: { composio: { url: "https://connect.composio.dev/mcp", headers: { "x-consumer-api-key": "raw-secret" } } } }),
    /headers.x-consumer-api-key must be configured through headersEnv/,
  );
});

test("validateConfig rejects missing required fields", () => {
  assert.throws(
    () =>
      validateConfig({
        version: 2,
        agent: {
          name: "Miu",
          ownerName: "Sếp",
          language: "vi",
          toneIntensity: 7,
        },
        llm: {
          provider: "openai-compatible",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      }),
    InvalidConfigError,
  );
});
