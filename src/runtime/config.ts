import { access, readFile, writeFile } from "node:fs/promises";

import { hasConfiguredOwner, type OwnerUserIdConfig } from "../channels/owner-policy.js";
import { InvalidConfigError, MissingConfigError } from "./errors.js";
import { getLocalTimeZone, isValidTimeZone } from "./locale.js";
import { getRuntimePaths, type RuntimePaths } from "./paths.js";

export type McpToolCategory = "read" | "local_write" | "external_write" | "public_action" | "destructive" | "money" | "unknown";
export type MemoryWritePolicy = "allow" | "ask" | "deny";
export type MemoryDeletePolicy = "allow" | "ask" | "deny";
export type MemoryRetrievalPolicy = "full" | "governed";
export type InternalToolPolicy = "allow" | "ask" | "deny";
export type WorkspaceExternalPathAccess = "read" | "write" | "readwrite";
export type WorkspaceExternalPathConfig = string | { path: string; access?: WorkspaceExternalPathAccess };
export type WorkforceAgentApprovalPolicy = "ask-for-external-actions" | "ask-for-all-actions" | "deny-external-actions";
export type PublicAgentToolPolicy = "deny" | "allowlist";
export type PublicAgentMemoryWritePolicy = "deny" | "pending" | "allow";

export interface PublicWorkforceAgentConfig {
  enabled: true;
  toolPolicy?: PublicAgentToolPolicy;
  customerMemory?: "isolated" | "primary";
  customerMemoryWrite?: PublicAgentMemoryWritePolicy;
  knowledgeAccess?: "agent-only" | "none" | "primary";
  allowUnsafeSharedData?: boolean;
}
type OpenAiCompatibleSpeechConfig = Extract<NonNullable<AppConfig["speech"]>, { provider: "openai-compatible" }>;

export type LlmAuthMode = "api-key" | "oauth" | "local";

export interface LlmProfileConfig {
  provider: string;
  mode: LlmAuthMode;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface LlmModelCatalogEntryConfig {
  profile: string;
}

export interface LlmMediaModelSelectionConfig {
  primary: string;
  fallbacks?: string[];
}

type OpenAiCompatibleTranscriptionConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  timeoutMs?: number;
};
type ElevenLabsTranscriptionConfig = {
  provider: "elevenlabs";
  apiKeyEnv: string;
  modelId?: string;
  languageCode?: string;
  tagAudioEvents?: boolean;
  diarize?: boolean;
  timeoutMs?: number;
};
type LocalWhisperTranscriptionConfig = {
  provider: "local-whisper";
  command: string;
  args?: string[];
  modelPath: string;
  timeoutMs?: number;
};
type VoiceboxTranscriptionConfig = {
  provider: "voicebox";
  baseUrl: string;
  model?: "base" | "small" | "medium" | "large" | "turbo";
  language?: string;
  clientId?: string;
  timeoutMs?: number;
};
export type TranscriptionProviderConfig = OpenAiCompatibleTranscriptionConfig | ElevenLabsTranscriptionConfig | LocalWhisperTranscriptionConfig | VoiceboxTranscriptionConfig;

export type MediaGenerationProviderConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  endpointPath?: string;
  timeoutMs?: number;
};

export type ImageGenerationConfig = MediaGenerationProviderConfig | {
  endpointPath?: string;
  timeoutMs?: number;
};

type OpenAiCompatibleSpeechProviderConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  voice?: string;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  timeoutMs?: number;
};
type ElevenLabsSpeechProviderConfig = {
  provider: "elevenlabs";
  apiKeyEnv: string;
  voiceId: string;
  modelId?: string;
  outputFormat?: string;
  timeoutMs?: number;
};
type VoiceboxSpeechProviderConfig = {
  provider: "voicebox";
  baseUrl: string;
  profile?: string;
  engine?: "qwen" | "qwen_custom_voice" | "luxtts" | "chatterbox" | "chatterbox_turbo" | "tada" | "kokoro";
  language?: string;
  clientId?: string;
  personality?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
};
type LocalCommandSpeechProviderConfig = {
  provider: "local-command";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  modelPath?: string;
  outputFormat?: "wav";
  timeoutMs?: number;
};
export type SpeechProviderConfig = OpenAiCompatibleSpeechProviderConfig | ElevenLabsSpeechProviderConfig | VoiceboxSpeechProviderConfig | LocalCommandSpeechProviderConfig;
export type AgentChannelBinding = "telegram" | "zalo" | "zalo-personal";

export interface AppConfig {
  version: 2;
  agent: {
    name: string;
    ownerName: string;
    language: string;
    timeZone?: string;
    toneIntensity: number;
  };
  llm: {
    primary: string;
    fallbacks?: string[];
    image?: LlmMediaModelSelectionConfig;
    authProfile: string;
    profiles: Record<string, LlmProfileConfig>;
    modelCatalog: Record<string, LlmModelCatalogEntryConfig>;
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  };
  transcription?: TranscriptionProviderConfig & { fallbacks?: TranscriptionProviderConfig[] };
  speech?: SpeechProviderConfig & { fallbacks?: SpeechProviderConfig[] };
  generation?: {
    image?: ImageGenerationConfig;
    video?: MediaGenerationProviderConfig;
  };
  channels?: {
    telegram?: {
      enabled: boolean;
      botTokenEnv: string;
      ownerUserId: OwnerUserIdConfig;
      adminUserIds?: string[];
      voiceReplyPolicy?: "deny" | "voice-input-only";
      voiceReplyMaxChars?: number;
      voiceReplyCooldownMs?: number;
      attachments?: {
        downloadPolicy?: "allow" | "deny";
        maxBytes?: number;
        previewMaxBytes?: number;
        parseMaxBytes?: number;
        visionPolicy?: "allow" | "deny";
        visionMaxBytes?: number;
        transcriptionPolicy?: "allow" | "deny";
        transcriptionMaxBytes?: number;
        deleteAfterProcessingKinds?: Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker">;
        allowedMimeTypes?: string[];
      };
    };
    zalo?: {
      enabled: boolean;
      botTokenEnv: string;
      ownerUserId: OwnerUserIdConfig;
      adminUserIds?: string[];
      pollingTimeoutSeconds?: number;
      attachments?: {
        downloadPolicy?: "allow" | "deny";
        maxBytes?: number;
        previewMaxBytes?: number;
        parseMaxBytes?: number;
        visionPolicy?: "allow" | "deny";
        visionMaxBytes?: number;
        transcriptionPolicy?: "allow" | "deny";
        transcriptionMaxBytes?: number;
        deleteAfterProcessingKinds?: Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker">;
        allowedMimeTypes?: string[];
      };
    };
    zaloPersonal?: {
      enabled: boolean;
      sessionEnv: string;
      ownerUserId: OwnerUserIdConfig;
      adminUserIds?: string[];
      reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
      };
      attachments?: {
        downloadPolicy?: "allow" | "deny";
        maxBytes?: number;
        previewMaxBytes?: number;
        parseMaxBytes?: number;
        visionPolicy?: "allow" | "deny";
        visionMaxBytes?: number;
        transcriptionPolicy?: "allow" | "deny";
        transcriptionMaxBytes?: number;
        deleteAfterProcessingKinds?: Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker">;
        allowedMimeTypes?: string[];
      };
    };
  };
  memory?: {
    writePolicy?: MemoryWritePolicy;
    deletePolicy?: MemoryDeletePolicy;
    retrievalPolicy?: MemoryRetrievalPolicy;
    recentMessageLimit?: number;
  };
  skills?: {
    registry?: {
      remoteOfficial?: {
        enabled: boolean;
        url: string;
        checksumUrl?: string;
        publicKey?: string;
        signatureHeader?: string;
        timeoutMs?: number;
        installPolicy?: "deny" | "ask";
      };
    };
  };
  workspace?: {
    defaultPath?: string;
    externalPaths?: WorkspaceExternalPathConfig[];
  };
  mcp?: {
    servers: Array<{
      name: string;
      enabled: boolean;
      transport?: "stdio" | "http" | "streamable-http";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      headersEnv?: Record<string, string>;
      auth?: {
        type: "oauth";
        authorizationUrl: string;
        tokenUrl?: string;
        clientId: string;
        scopes?: string[];
        redirectUri?: string;
        resource?: string;
        envVar: string;
        headerName?: string;
      };
      tools?: Array<{
        name: string;
        category: McpToolCategory;
      }>;
    }>;
  };
  internalTools?: {
    policies?: Record<string, InternalToolPolicy>;
    exec?: {
      timeoutMs?: number;
    };
    browser?: {
      cdpEndpoint?: string;
    };
  };
  agents?: Record<string, {
    enabled: boolean;
    displayName: string;
    role: string;
    description: string;
    promptPath: string;
    model?: string;
    tools?: string[];
    channels?: AgentChannelBinding[];
    memoryScope: string;
    approvalPolicy: WorkforceAgentApprovalPolicy;
    public?: PublicWorkforceAgentConfig;
  }>;
}

export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
export const DEFAULT_LLM_MAX_RETRIES = 3;
export const DEFAULT_LLM_RETRY_DELAY_MS = 500;
export const DEFAULT_INTERNAL_EXEC_TIMEOUT_MS = 300_000;

export async function configExists(paths: RuntimePaths = getRuntimePaths()): Promise<boolean> {
  try {
    await access(paths.configPath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(paths: RuntimePaths = getRuntimePaths()): Promise<AppConfig> {
  let rawConfig: string;

  try {
    rawConfig = await readFile(paths.configPath, "utf8");
  } catch {
    throw new MissingConfigError(paths.configPath);
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    throw new InvalidConfigError("config.json is not valid JSON.");
  }

  return validateConfig(parsedConfig);
}

export async function writeConfig(config: AppConfig, paths: RuntimePaths = getRuntimePaths()): Promise<void> {
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function validateConfig(config: unknown): AppConfig {
  if (!isRecord(config)) {
    throw new InvalidConfigError("expected an object.");
  }

  if (config.version !== 2) {
    throw new InvalidConfigError("version must be 2.");
  }

  const agent = requireRecord(config.agent, "agent");
  const llm = requireRecord(config.llm, "llm");
  const language = requireString(agent.language, "agent.language");
  const timeZone = agent.timeZone === undefined ? getLocalTimeZone() : requireString(agent.timeZone, "agent.timeZone");
  if (!isValidTimeZone(timeZone)) {
    throw new InvalidConfigError("agent.timeZone must be a valid IANA time zone.");
  }

  const toneIntensity = requireNumber(agent.toneIntensity, "agent.toneIntensity");
  if (!Number.isInteger(toneIntensity) || toneIntensity < 1 || toneIntensity > 10) {
    throw new InvalidConfigError("agent.toneIntensity must be an integer from 1 to 10.");
  }

  const timeoutMs = optionalPositiveInteger(llm.timeoutMs, "llm.timeoutMs");
  const maxRetries = optionalNonNegativeInteger(llm.maxRetries, "llm.maxRetries");
  const retryDelayMs = optionalNonNegativeInteger(llm.retryDelayMs, "llm.retryDelayMs");
  const channels = optionalChannels(config.channels);
  const transcription = optionalTranscription(config.transcription);
  const speech = optionalSpeech(config.speech);
  const generation = optionalGeneration(config.generation);
  const memory = optionalMemory(config.memory);
  const skills = optionalSkills(config.skills);
  const workspace = optionalWorkspace(config.workspace);
  const mcp = optionalMcp(config.mcp, config.mcpServers);
  const internalTools = optionalInternalTools(config.internalTools);
  const agents = optionalAgents(config.agents);
  validatePublicChannelBindings(channels, agents);

  return {
    version: 2,
    agent: {
      name: requireString(agent.name, "agent.name"),
      ownerName: requireString(agent.ownerName, "agent.ownerName"),
      language,
      timeZone,
      toneIntensity,
    },
    llm: {
      primary: requireModelRefString(llm.primary, "llm.primary"),
      authProfile: requireString(llm.authProfile, "llm.authProfile"),
      profiles: requireLlmProfiles(llm.profiles),
      modelCatalog: requireLlmModelCatalog(llm.modelCatalog),
      ...(llm.fallbacks === undefined ? {} : { fallbacks: optionalModelRefArray(llm.fallbacks, "llm.fallbacks") }),
      ...(llm.image === undefined ? {} : { image: optionalLlmMediaModelSelection(llm.image, "llm.image") }),
      timeoutMs,
      maxRetries,
      retryDelayMs,
    },
    ...(transcription === undefined ? {} : { transcription }),
    ...(speech === undefined ? {} : { speech }),
    ...(generation === undefined ? {} : { generation }),
    ...(channels === undefined ? {} : { channels }),
    ...(memory === undefined ? {} : { memory }),
    ...(skills === undefined ? {} : { skills }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(mcp === undefined ? {} : { mcp }),
    ...(internalTools === undefined ? {} : { internalTools }),
    ...(agents === undefined ? {} : { agents }),
  };
}

function optionalGeneration(value: unknown): AppConfig["generation"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const generation = requireRecord(value, "generation");
  return {
    ...(generation.image === undefined ? {} : { image: parseImageGenerationConfig(generation.image) }),
    ...(generation.video === undefined ? {} : { video: parseMediaGenerationProvider(generation.video, "generation.video") }),
  };
}

function parseImageGenerationConfig(value: unknown): ImageGenerationConfig {
  const image = requireRecord(value, "generation.image");
  if (image.provider !== undefined || image.baseUrl !== undefined || image.model !== undefined || image.apiKeyEnv !== undefined) {
    return parseMediaGenerationProvider(value, "generation.image");
  }

  return {
    ...(image.endpointPath === undefined ? {} : { endpointPath: requireString(image.endpointPath, "generation.image.endpointPath") }),
    ...(image.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(image.timeoutMs, "generation.image.timeoutMs") }),
  };
}

function parseMediaGenerationProvider(value: unknown, path: string): MediaGenerationProviderConfig {
  const provider = requireRecord(value, path);
  const providerName = requireString(provider.provider, `${path}.provider`);
  if (providerName !== "openai-compatible") {
    throw new InvalidConfigError(`${path}.provider must be openai-compatible.`);
  }

  return {
    provider: providerName,
    baseUrl: requireString(provider.baseUrl, `${path}.baseUrl`),
    model: requireString(provider.model, `${path}.model`),
    apiKeyEnv: requireString(provider.apiKeyEnv, `${path}.apiKeyEnv`),
    ...(provider.endpointPath === undefined ? {} : { endpointPath: requireString(provider.endpointPath, `${path}.endpointPath`) }),
    ...(provider.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(provider.timeoutMs, `${path}.timeoutMs`) }),
  };
}

function optionalTranscription(value: unknown): AppConfig["transcription"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const transcription = parseTranscriptionProvider(value, "transcription");
  const raw = requireRecord(value, "transcription");
  return {
    ...transcription,
    ...(raw.fallbacks === undefined ? {} : { fallbacks: optionalTranscriptionFallbacks(raw.fallbacks) }),
  } as AppConfig["transcription"];
}

function parseTranscriptionProvider(value: unknown, path: string): TranscriptionProviderConfig {
  const transcription = requireRecord(value, path);
  const provider = requireString(transcription.provider, `${path}.provider`);
  if (provider !== "openai-compatible" && provider !== "elevenlabs" && provider !== "local-whisper" && provider !== "voicebox") {
    throw new InvalidConfigError(`${path}.provider must be openai-compatible, elevenlabs, local-whisper, or voicebox.`);
  }

  if (provider === "elevenlabs") {
    return {
      provider,
      apiKeyEnv: requireString(transcription.apiKeyEnv, `${path}.apiKeyEnv`),
      ...(transcription.modelId === undefined ? {} : { modelId: requireString(transcription.modelId, `${path}.modelId`) }),
      ...(transcription.languageCode === undefined ? {} : { languageCode: requireString(transcription.languageCode, `${path}.languageCode`) }),
      ...(transcription.tagAudioEvents === undefined ? {} : { tagAudioEvents: requireBoolean(transcription.tagAudioEvents, `${path}.tagAudioEvents`) }),
      ...(transcription.diarize === undefined ? {} : { diarize: requireBoolean(transcription.diarize, `${path}.diarize`) }),
      ...(transcription.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(transcription.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  if (provider === "local-whisper") {
    const args = optionalStringArray(transcription.args, `${path}.args`);
    if (args !== undefined && !args.some((arg) => arg.includes("{audioPath}"))) {
      throw new InvalidConfigError(`${path}.args must include {audioPath}.`);
    }

    return {
      provider,
      command: requireString(transcription.command, `${path}.command`),
      ...(args === undefined ? {} : { args }),
      modelPath: requireString(transcription.modelPath, `${path}.modelPath`),
      ...(transcription.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(transcription.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  if (provider === "voicebox") {
    const model = transcription.model;
    if (model !== undefined && !["base", "small", "medium", "large", "turbo"].includes(String(model))) {
      throw new InvalidConfigError(`${path}.model must be base, small, medium, large, or turbo.`);
    }

    return {
      provider,
      baseUrl: requireString(transcription.baseUrl, `${path}.baseUrl`).replace(/\/+$/, ""),
      ...(model === undefined ? {} : { model: model as VoiceboxTranscriptionConfig["model"] }),
      ...(transcription.language === undefined ? {} : { language: requireString(transcription.language, `${path}.language`) }),
      ...(transcription.clientId === undefined ? {} : { clientId: requireString(transcription.clientId, `${path}.clientId`) }),
      ...(transcription.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(transcription.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  return {
    provider,
    baseUrl: requireString(transcription.baseUrl, `${path}.baseUrl`),
    model: requireString(transcription.model, `${path}.model`),
    apiKeyEnv: requireString(transcription.apiKeyEnv, `${path}.apiKeyEnv`),
    ...(transcription.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(transcription.timeoutMs, `${path}.timeoutMs`) }),
  };
}

function optionalSpeech(value: unknown): AppConfig["speech"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const speech = parseSpeechProvider(value, "speech");
  const raw = requireRecord(value, "speech");
  return {
    ...speech,
    ...(raw.fallbacks === undefined ? {} : { fallbacks: optionalSpeechFallbacks(raw.fallbacks) }),
  } as AppConfig["speech"];
}

function parseSpeechProvider(value: unknown, path: string): SpeechProviderConfig {
  const speech = requireRecord(value, path);
  const provider = requireString(speech.provider, `${path}.provider`);
  if (provider !== "openai-compatible" && provider !== "elevenlabs" && provider !== "voicebox" && provider !== "local-command") {
    throw new InvalidConfigError(`${path}.provider must be openai-compatible, elevenlabs, voicebox, or local-command.`);
  }

  if (provider === "elevenlabs") {
    return {
      provider,
      apiKeyEnv: requireString(speech.apiKeyEnv, `${path}.apiKeyEnv`),
      voiceId: requireString(speech.voiceId, `${path}.voiceId`),
      ...(speech.modelId === undefined ? {} : { modelId: requireString(speech.modelId, `${path}.modelId`) }),
      ...(speech.outputFormat === undefined ? {} : { outputFormat: requireString(speech.outputFormat, `${path}.outputFormat`) }),
      ...(speech.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(speech.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  if (provider === "voicebox") {
    const engine = speech.engine;
    if (engine !== undefined && !["qwen", "qwen_custom_voice", "luxtts", "chatterbox", "chatterbox_turbo", "tada", "kokoro"].includes(String(engine))) {
      throw new InvalidConfigError(`${path}.engine must be qwen, qwen_custom_voice, luxtts, chatterbox, chatterbox_turbo, tada, or kokoro.`);
    }

    return {
      provider,
      baseUrl: requireString(speech.baseUrl, `${path}.baseUrl`).replace(/\/+$/, ""),
      ...(speech.profile === undefined ? {} : { profile: requireString(speech.profile, `${path}.profile`) }),
      ...(engine === undefined ? {} : { engine: engine as VoiceboxSpeechProviderConfig["engine"] }),
      ...(speech.language === undefined ? {} : { language: requireString(speech.language, `${path}.language`) }),
      ...(speech.clientId === undefined ? {} : { clientId: requireString(speech.clientId, `${path}.clientId`) }),
      ...(speech.personality === undefined ? {} : { personality: requireBoolean(speech.personality, `${path}.personality`) }),
      ...(speech.pollIntervalMs === undefined ? {} : { pollIntervalMs: optionalPositiveInteger(speech.pollIntervalMs, `${path}.pollIntervalMs`) }),
      ...(speech.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(speech.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  if (provider === "local-command") {
    const outputFormat = speech.outputFormat;
    if (outputFormat !== undefined && outputFormat !== "wav") {
      throw new InvalidConfigError(`${path}.outputFormat must be wav for local-command.`);
    }

    return {
      provider,
      command: requireString(speech.command, `${path}.command`),
      ...(speech.args === undefined ? {} : { args: requireStringArray(speech.args, `${path}.args`) }),
      ...(speech.env === undefined ? {} : { env: requireStringRecord(speech.env, `${path}.env`) }),
      ...(speech.modelPath === undefined ? {} : { modelPath: requireString(speech.modelPath, `${path}.modelPath`) }),
      ...(outputFormat === undefined ? {} : { outputFormat }),
      ...(speech.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(speech.timeoutMs, `${path}.timeoutMs`) }),
    };
  }

  const responseFormat = speech.responseFormat;
  if (responseFormat !== undefined && !["mp3", "opus", "aac", "flac", "wav", "pcm"].includes(String(responseFormat))) {
    throw new InvalidConfigError(`${path}.responseFormat must be mp3, opus, aac, flac, wav, or pcm.`);
  }

  return {
    provider,
    baseUrl: requireString(speech.baseUrl, `${path}.baseUrl`),
    model: requireString(speech.model, `${path}.model`),
    apiKeyEnv: requireString(speech.apiKeyEnv, `${path}.apiKeyEnv`),
    ...(speech.voice === undefined ? {} : { voice: requireString(speech.voice, `${path}.voice`) }),
    ...(responseFormat === undefined ? {} : { responseFormat: responseFormat as OpenAiCompatibleSpeechConfig["responseFormat"] }),
    ...(speech.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(speech.timeoutMs, `${path}.timeoutMs`) }),
  };
}

function requireLlmProfiles(value: unknown): Record<string, LlmProfileConfig> {
  const profiles = requireRecord(value, "llm.profiles");
  const result: Record<string, LlmProfileConfig> = {};
  for (const [profileId, rawProfile] of Object.entries(profiles)) {
    const path = `llm.profiles.${profileId}`;
    const profile = requireRecord(rawProfile, path);
    const mode = requireString(profile.mode, `${path}.mode`);
    if (mode !== "api-key" && mode !== "oauth" && mode !== "local") {
      throw new InvalidConfigError(`${path}.mode must be api-key, oauth, or local.`);
    }
    const apiKeyEnv = profile.apiKeyEnv === undefined ? undefined : requireString(profile.apiKeyEnv, `${path}.apiKeyEnv`);
    if ((mode === "api-key" || mode === "oauth") && !apiKeyEnv) {
      throw new InvalidConfigError(`${path}.apiKeyEnv is required for ${mode} profiles.`);
    }
    const provider = requireString(profile.provider, `${path}.provider`);
    const baseUrl = profile.baseUrl === undefined ? undefined : requireString(profile.baseUrl, `${path}.baseUrl`);
    if (provider !== "claude-cli" && provider !== "codex-cli" && provider !== "gemini-cli" && provider !== "gemini" && !baseUrl) {
      throw new InvalidConfigError(`${path}.baseUrl is required for ${provider} profiles.`);
    }
    result[profileId] = {
      provider,
      mode,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    };
  }
  return result;
}

function requireLlmModelCatalog(value: unknown): Record<string, LlmModelCatalogEntryConfig> {
  const catalog = requireRecord(value, "llm.modelCatalog");
  const result: Record<string, LlmModelCatalogEntryConfig> = {};
  for (const [modelRef, rawEntry] of Object.entries(catalog)) {
    const path = `llm.modelCatalog.${modelRef}`;
    requireModelRefString(modelRef, path);
    const entry = requireRecord(rawEntry, path);
    result[modelRef] = { profile: requireString(entry.profile, `${path}.profile`) };
  }
  return result;
}

function optionalModelRefArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigError(`${path} must be an array.`);
  }

  return value.map((entry, index) => requireModelRefString(entry, `${path}.${index}`));
}

function optionalLlmMediaModelSelection(value: unknown, path: string): LlmMediaModelSelectionConfig {
  const selection = requireRecord(value, path);
  return {
    primary: requireModelRefString(selection.primary, `${path}.primary`),
    ...(selection.fallbacks === undefined ? {} : { fallbacks: optionalModelRefArray(selection.fallbacks, `${path}.fallbacks`) }),
  };
}

function requireModelRefString(value: unknown, path: string): string {
  const modelRef = requireString(value, path);
  const slashIndex = modelRef.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
    throw new InvalidConfigError(`${path} must use provider/model format.`);
  }
  return modelRef;
}

function optionalTranscriptionFallbacks(value: unknown): TranscriptionProviderConfig[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigError("transcription.fallbacks must be an array.");
  }

  return value.map((fallback, index) => parseTranscriptionProvider(fallback, `transcription.fallbacks.${index}`));
}

function optionalSpeechFallbacks(value: unknown): SpeechProviderConfig[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigError("speech.fallbacks must be an array.");
  }

  return value.map((fallback, index) => parseSpeechProvider(fallback, `speech.fallbacks.${index}`));
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new InvalidConfigError(`${path} must be an array of non-empty strings.`);
  }

  return value;
}

function optionalWorkspace(value: unknown): AppConfig["workspace"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const workspace = requireRecord(value, "workspace");
  const defaultPath = workspace.defaultPath === undefined ? undefined : requireString(workspace.defaultPath, "workspace.defaultPath");
  const externalPaths = workspace.externalPaths;

  if (externalPaths !== undefined && !Array.isArray(externalPaths)) {
    throw new InvalidConfigError("workspace.externalPaths must be an array of non-empty strings or access objects.");
  }

  if (externalPaths?.some((path) => !isValidWorkspaceExternalPath(path))) {
    throw new InvalidConfigError("workspace.externalPaths must be an array of non-empty strings or objects with path and access read|write|readwrite.");
  }

  return {
    ...(defaultPath === undefined ? {} : { defaultPath }),
    ...(externalPaths === undefined ? {} : { externalPaths }),
  };
}

function isValidWorkspaceExternalPath(value: unknown): value is WorkspaceExternalPathConfig {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    return false;
  }
  return value.access === undefined || value.access === "read" || value.access === "write" || value.access === "readwrite";
}

function optionalAgents(value: unknown): AppConfig["agents"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new InvalidConfigError("agents must be an object keyed by agent id.");
  }

  const agents: NonNullable<AppConfig["agents"]> = {};
  const assignedChannels = new Set<AgentChannelBinding>();
  for (const [id, agentValue] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) {
      throw new InvalidConfigError("agents keys must use lowercase letters, numbers, or hyphens.");
    }
    const agent = requireRecord(agentValue, `agents.${id}`);
    const approvalPolicy = agent.approvalPolicy;
    if (approvalPolicy !== "ask-for-external-actions" && approvalPolicy !== "ask-for-all-actions" && approvalPolicy !== "deny-external-actions") {
      throw new InvalidConfigError(`agents.${id}.approvalPolicy must be ask-for-external-actions, ask-for-all-actions, or deny-external-actions.`);
    }

    const channels = agent.channels === undefined ? undefined : optionalAgentChannels(agent.channels, `agents.${id}.channels`);
    for (const channel of channels ?? []) {
      if (assignedChannels.has(channel)) {
        throw new InvalidConfigError(`agents channel '${channel}' is assigned to more than one agent.`);
      }
      assignedChannels.add(channel);
    }

    const publicConfig = optionalPublicWorkforceAgentConfig(agent.public, `agents.${id}.public`);
    agents[id] = {
      enabled: requireBoolean(agent.enabled, `agents.${id}.enabled`),
      displayName: requireString(agent.displayName, `agents.${id}.displayName`),
      role: requireString(agent.role, `agents.${id}.role`),
      description: requireString(agent.description, `agents.${id}.description`),
      promptPath: requireString(agent.promptPath, `agents.${id}.promptPath`),
      ...(agent.model === undefined ? {} : { model: requireModelRefString(agent.model, `agents.${id}.model`) }),
      ...(agent.tools === undefined ? {} : { tools: optionalStringArray(agent.tools, `agents.${id}.tools`) ?? [] }),
      ...(channels === undefined ? {} : { channels }),
      memoryScope: requireString(agent.memoryScope, `agents.${id}.memoryScope`),
      approvalPolicy,
      ...(publicConfig === undefined ? {} : { public: publicConfig }),
    };
  }

  return agents;
}

function optionalInternalTools(value: unknown): AppConfig["internalTools"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const internalTools = requireRecord(value, "internalTools");
  const policies = internalTools.policies;
  const exec = optionalInternalExec(internalTools.exec);
  const browser = optionalInternalBrowser(internalTools.browser);

  if (policies === undefined) {
    return { ...(exec === undefined ? {} : { exec }), ...(browser === undefined ? {} : { browser }) };
  }

  if (!isRecord(policies)) {
    throw new InvalidConfigError("internalTools.policies must be an object.");
  }

  const validated: Record<string, InternalToolPolicy> = {};
  for (const [toolName, policy] of Object.entries(policies)) {
    if (policy !== "allow" && policy !== "ask" && policy !== "deny") {
      throw new InvalidConfigError(`internalTools.policies.${toolName} must be allow, ask, or deny.`);
    }
    validated[toolName] = policy;
  }

  return { policies: validated, ...(exec === undefined ? {} : { exec }), ...(browser === undefined ? {} : { browser }) };
}

function optionalPublicWorkforceAgentConfig(value: unknown, path: string): PublicWorkforceAgentConfig | undefined {
  if (value === undefined) return undefined;
  const policy = requireRecord(value, path);
  if (policy.enabled !== true) throw new InvalidConfigError(`${path}.enabled must be true when public policy is configured.`);
  if (policy.toolPolicy !== undefined && policy.toolPolicy !== "deny" && policy.toolPolicy !== "allowlist") throw new InvalidConfigError(`${path}.toolPolicy must be deny or allowlist.`);
  if (policy.customerMemory !== undefined && policy.customerMemory !== "isolated" && policy.customerMemory !== "primary") throw new InvalidConfigError(`${path}.customerMemory must be isolated or primary.`);
  if (policy.customerMemoryWrite !== undefined && !["deny", "pending", "allow"].includes(String(policy.customerMemoryWrite))) throw new InvalidConfigError(`${path}.customerMemoryWrite must be deny, pending, or allow.`);
  if (policy.knowledgeAccess !== undefined && policy.knowledgeAccess !== "agent-only" && policy.knowledgeAccess !== "none" && policy.knowledgeAccess !== "primary") throw new InvalidConfigError(`${path}.knowledgeAccess must be agent-only, none, or primary.`);
  if (policy.allowUnsafeSharedData !== undefined && typeof policy.allowUnsafeSharedData !== "boolean") throw new InvalidConfigError(`${path}.allowUnsafeSharedData must be a boolean.`);
  if (policy.toolPolicy === "allowlist" && policy.allowUnsafeSharedData !== true) {
    throw new InvalidConfigError(`${path}.toolPolicy=allowlist requires ${path}.allowUnsafeSharedData=true because tools can access data outside the customer namespace.`);
  }
  if ((policy.customerMemory === "primary" || policy.knowledgeAccess === "primary") && policy.allowUnsafeSharedData !== true) {
    throw new InvalidConfigError(`${path} shared primary data requires ${path}.allowUnsafeSharedData=true.`);
  }
  return {
    enabled: true,
    ...(policy.toolPolicy === undefined ? {} : { toolPolicy: policy.toolPolicy as PublicAgentToolPolicy }),
    ...(policy.customerMemory === undefined ? {} : { customerMemory: policy.customerMemory as "isolated" | "primary" }),
    ...(policy.customerMemoryWrite === undefined ? {} : { customerMemoryWrite: policy.customerMemoryWrite as PublicAgentMemoryWritePolicy }),
    ...(policy.knowledgeAccess === undefined ? {} : { knowledgeAccess: policy.knowledgeAccess as "agent-only" | "none" | "primary" }),
    ...(policy.allowUnsafeSharedData === undefined ? {} : { allowUnsafeSharedData: policy.allowUnsafeSharedData }),
  };
}

function validatePublicChannelBindings(channels: AppConfig["channels"] | undefined, agents: AppConfig["agents"] | undefined): void {
  const wildcardChannels = (Object.entries({ telegram: channels?.telegram, zalo: channels?.zalo, "zalo-personal": channels?.zaloPersonal }) as Array<[AgentChannelBinding, { ownerUserId: OwnerUserIdConfig } | undefined]>)
    .filter(([, channel]) => Array.isArray(channel?.ownerUserId) && channel.ownerUserId.length === 1 && channel.ownerUserId[0] === "*")
    .map(([channel]) => channel);
  if (wildcardChannels.length === 0) return;
  if (!agents) {
    throw new InvalidConfigError(`Public channel ${wildcardChannels.join(", ")} requires a bound workforce agent with an explicit public policy.`);
  }
  for (const [id, agent] of Object.entries(agents)) {
    for (const channel of agent.channels ?? []) {
      const channelConfig = channel === "telegram" ? channels?.telegram : channel === "zalo" ? channels?.zalo : channels?.zaloPersonal;
      if (channelConfig && Array.isArray(channelConfig.ownerUserId) && channelConfig.ownerUserId.length === 1 && channelConfig.ownerUserId[0] === "*") {
        if (!agent.public?.enabled) {
          throw new InvalidConfigError(`agents.${id}.public must be explicitly configured before binding to public ${channel}.`);
        }
        if (!agent.enabled) {
          throw new InvalidConfigError(`agents.${id}.enabled must be true while bound to public ${channel}. Disable the channel or bind an enabled public agent first.`);
        }
      }
    }
  }
  for (const channel of wildcardChannels) {
    if (!Object.values(agents).some((agent) => agent.channels?.includes(channel))) {
      throw new InvalidConfigError(`Public channel ${channel} requires a bound workforce agent with an explicit public policy.`);
    }
  }
}

function optionalAgentChannels(value: unknown, path: string): AgentChannelBinding[] {
  const channels = optionalStringArray(value, path);
  if (!channels || channels.length === 0) {
    throw new InvalidConfigError(`${path} must include at least one of telegram, zalo, or zalo-personal.`);
  }
  const validChannels: AgentChannelBinding[] = ["telegram", "zalo", "zalo-personal"];
  if (channels.some((channel) => !validChannels.includes(channel as AgentChannelBinding))) {
    throw new InvalidConfigError(`${path} must contain only telegram, zalo, or zalo-personal.`);
  }
  if (new Set(channels).size !== channels.length) {
    throw new InvalidConfigError(`${path} must not contain duplicate channels.`);
  }
  return channels as AgentChannelBinding[];
}

function optionalInternalExec(value: unknown): NonNullable<AppConfig["internalTools"]>["exec"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const exec = requireRecord(value, "internalTools.exec");
  const timeoutMs = optionalPositiveInteger(exec.timeoutMs, "internalTools.exec.timeoutMs");

  return timeoutMs === undefined ? {} : { timeoutMs };
}

function optionalInternalBrowser(value: unknown): NonNullable<AppConfig["internalTools"]>["browser"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const browser = requireRecord(value, "internalTools.browser");
  const cdpEndpoint = browser.cdpEndpoint === undefined ? undefined : requireString(browser.cdpEndpoint, "internalTools.browser.cdpEndpoint");
  if (cdpEndpoint !== undefined && !isLocalCdpEndpoint(cdpEndpoint)) {
    throw new InvalidConfigError("internalTools.browser.cdpEndpoint must be an http(s) or ws(s) loopback URL without credentials.");
  }

  return cdpEndpoint === undefined ? {} : { cdpEndpoint };
}

function isLocalCdpEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (!/^https?:$|^wss?:$/.test(url.protocol) || url.username || url.password) {
      return false;
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

function optionalMemory(value: unknown): AppConfig["memory"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const memory = requireRecord(value, "memory");
  const writePolicy = memory.writePolicy;
  const deletePolicy = memory.deletePolicy;
  const retrievalPolicy = memory.retrievalPolicy;
  const recentMessageLimit = optionalPositiveInteger(memory.recentMessageLimit, "memory.recentMessageLimit");

  if (writePolicy !== undefined && writePolicy !== "allow" && writePolicy !== "ask" && writePolicy !== "deny") {
    throw new InvalidConfigError("memory.writePolicy must be allow, ask, or deny.");
  }

  if (deletePolicy !== undefined && deletePolicy !== "allow" && deletePolicy !== "ask" && deletePolicy !== "deny") {
    throw new InvalidConfigError("memory.deletePolicy must be allow, ask, or deny.");
  }

  if (retrievalPolicy !== undefined && retrievalPolicy !== "full" && retrievalPolicy !== "governed") {
    throw new InvalidConfigError("memory.retrievalPolicy must be full or governed.");
  }

  return {
    ...(writePolicy === undefined ? {} : { writePolicy }),
    ...(deletePolicy === undefined ? {} : { deletePolicy }),
    ...(retrievalPolicy === undefined ? {} : { retrievalPolicy }),
    ...(recentMessageLimit === undefined ? {} : { recentMessageLimit }),
  };
}

function optionalSkills(value: unknown): AppConfig["skills"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const skills = requireRecord(value, "skills");
  if (skills.registry === undefined) {
    return {};
  }

  const registry = requireRecord(skills.registry, "skills.registry");
  if (registry.remoteOfficial === undefined) {
    return { registry: {} };
  }

  const remoteOfficial = requireRecord(registry.remoteOfficial, "skills.registry.remoteOfficial");
  const enabled = requireBoolean(remoteOfficial.enabled, "skills.registry.remoteOfficial.enabled");
  const url = requireString(remoteOfficial.url, "skills.registry.remoteOfficial.url");
  if (!url.startsWith("https://")) {
    throw new InvalidConfigError("skills.registry.remoteOfficial.url must use https://.");
  }
  const checksumUrl = remoteOfficial.checksumUrl === undefined ? undefined : requireString(remoteOfficial.checksumUrl, "skills.registry.remoteOfficial.checksumUrl");
  if (checksumUrl !== undefined && !checksumUrl.startsWith("https://")) {
    throw new InvalidConfigError("skills.registry.remoteOfficial.checksumUrl must use https://.");
  }

  return {
    registry: {
      remoteOfficial: {
        enabled,
        url,
        ...(checksumUrl === undefined ? {} : { checksumUrl }),
        ...(remoteOfficial.publicKey === undefined ? {} : { publicKey: requireString(remoteOfficial.publicKey, "skills.registry.remoteOfficial.publicKey") }),
        ...(remoteOfficial.signatureHeader === undefined ? {} : { signatureHeader: requireString(remoteOfficial.signatureHeader, "skills.registry.remoteOfficial.signatureHeader") }),
        ...(remoteOfficial.timeoutMs === undefined ? {} : { timeoutMs: optionalPositiveInteger(remoteOfficial.timeoutMs, "skills.registry.remoteOfficial.timeoutMs") }),
        ...(remoteOfficial.installPolicy === undefined ? {} : { installPolicy: optionalRemoteInstallPolicy(remoteOfficial.installPolicy) }),
      },
    },
  };
}

function optionalRemoteInstallPolicy(value: unknown): "deny" | "ask" {
  if (value !== "deny" && value !== "ask") {
    throw new InvalidConfigError("skills.registry.remoteOfficial.installPolicy must be deny or ask.");
  }
  return value;
}

function optionalMcp(value: unknown, legacyMcpServers: unknown): AppConfig["mcp"] | undefined {
  if (value === undefined && legacyMcpServers === undefined) {
    return undefined;
  }

  if (value === undefined) {
    return { servers: mcpServersToServerList(legacyMcpServers) };
  }

  const mcp = requireRecord(value, "mcp");
  const servers = mcp.servers;

  if (!Array.isArray(servers)) {
    throw new InvalidConfigError("mcp.servers must be an array.");
  }

  return { servers: servers.map((server, index) => validateMcpServer(server, index)) };
}

function mcpServersToServerList(value: unknown): NonNullable<AppConfig["mcp"]>["servers"] {
  const mcpServers = requireRecord(value, "mcpServers");
  return Object.entries(mcpServers).map(([name, server], index) => {
    const remoteServer = requireRecord(server, `mcpServers.${name}`);
    return validateMcpServer({ ...remoteServer, name, enabled: remoteServer.enabled ?? true, transport: remoteServer.transport ?? "http" }, index);
  });
}

function validateMcpServer(value: unknown, index: number): NonNullable<AppConfig["mcp"]>["servers"][number] {
  const fieldName = `mcp.servers[${index}]`;
  const server = requireRecord(value, fieldName);

  if (typeof server.enabled !== "boolean") {
    throw new InvalidConfigError(`${fieldName}.enabled must be a boolean.`);
  }

  const args = server.args;
  const env = server.env;
  const transport = server.transport === undefined ? "stdio" : requireString(server.transport, `${fieldName}.transport`);
  const headers = server.headers;
  const headersEnv = server.headersEnv;
  const auth = server.auth;
  const tools = server.tools;

  if (transport !== "stdio" && transport !== "http" && transport !== "streamable-http") {
    throw new InvalidConfigError(`${fieldName}.transport must be stdio, http, or streamable-http.`);
  }

  if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))) {
    throw new InvalidConfigError(`${fieldName}.args must be an array of strings.`);
  }

  if (env !== undefined && (!isRecord(env) || Object.values(env).some((envValue) => typeof envValue !== "string"))) {
    throw new InvalidConfigError(`${fieldName}.env must be an object of string values.`);
  }

  if (headers !== undefined && (!isRecord(headers) || Object.values(headers).some((headerValue) => typeof headerValue !== "string"))) {
    throw new InvalidConfigError(`${fieldName}.headers must be an object of string values.`);
  }

  if (headersEnv !== undefined && (!isRecord(headersEnv) || Object.values(headersEnv).some((envName) => typeof envName !== "string" || envName.trim().length === 0))) {
    throw new InvalidConfigError(`${fieldName}.headersEnv must be an object of non-empty env var names.`);
  }

  if (transport === "stdio" && typeof server.command !== "string") {
    throw new InvalidConfigError(`${fieldName}.command must be a non-empty string for stdio MCP servers.`);
  }

  if (transport === "http" || transport === "streamable-http") {
    const url = requireString(server.url, `${fieldName}.url`);
    if (!isHttpUrl(url)) {
      throw new InvalidConfigError(`${fieldName}.url must be an HTTP(S) URL.`);
    }
    for (const headerName of Object.keys((headers as Record<string, string> | undefined) ?? {})) {
      if (isSensitiveHeaderName(headerName)) {
        throw new InvalidConfigError(`${fieldName}.headers.${headerName} must be configured through headersEnv, not raw config.`);
      }
    }
  }

  if (tools !== undefined && !Array.isArray(tools)) {
    throw new InvalidConfigError(`${fieldName}.tools must be an array.`);
  }

  return {
    name: requireString(server.name, `${fieldName}.name`),
    enabled: server.enabled,
    transport,
    ...(transport === "stdio" ? { command: requireString(server.command, `${fieldName}.command`) } : { url: requireString(server.url, `${fieldName}.url`) }),
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env: env as Record<string, string> }),
    ...(headers === undefined ? {} : { headers: headers as Record<string, string> }),
    ...(headersEnv === undefined ? {} : { headersEnv: headersEnv as Record<string, string> }),
    ...(auth === undefined ? {} : { auth: validateMcpAuth(auth, `${fieldName}.auth`) }),
    ...(tools === undefined ? {} : { tools: tools.map((tool, toolIndex) => validateMcpTool(tool, `${fieldName}.tools[${toolIndex}]`)) }),
  };
}

function validateMcpAuth(value: unknown, fieldName: string): NonNullable<NonNullable<AppConfig["mcp"]>["servers"][number]["auth"]> {
  const auth = requireRecord(value, fieldName);
  const type = requireString(auth.type, `${fieldName}.type`);
  if (type !== "oauth") {
    throw new InvalidConfigError(`${fieldName}.type must be oauth.`);
  }

  const authorizationUrl = requireString(auth.authorizationUrl, `${fieldName}.authorizationUrl`);
  if (!isHttpUrl(authorizationUrl)) {
    throw new InvalidConfigError(`${fieldName}.authorizationUrl must be an HTTP(S) URL.`);
  }

  const tokenUrl = auth.tokenUrl === undefined ? undefined : requireString(auth.tokenUrl, `${fieldName}.tokenUrl`);
  if (tokenUrl !== undefined && !isHttpUrl(tokenUrl)) {
    throw new InvalidConfigError(`${fieldName}.tokenUrl must be an HTTP(S) URL.`);
  }

  return {
    type,
    authorizationUrl,
    ...(tokenUrl === undefined ? {} : { tokenUrl }),
    clientId: requireString(auth.clientId, `${fieldName}.clientId`),
    ...(auth.scopes === undefined ? {} : { scopes: optionalStringArray(auth.scopes, `${fieldName}.scopes`) ?? [] }),
    ...(auth.redirectUri === undefined ? {} : { redirectUri: requireString(auth.redirectUri, `${fieldName}.redirectUri`) }),
    ...(auth.resource === undefined ? {} : { resource: requireString(auth.resource, `${fieldName}.resource`) }),
    envVar: requireString(auth.envVar, `${fieldName}.envVar`),
    ...(auth.headerName === undefined ? {} : { headerName: requireString(auth.headerName, `${fieldName}.headerName`) }),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSensitiveHeaderName(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "authorization" || normalized === "cookie" || normalized.includes("api-key") || normalized.includes("token") || normalized.includes("secret");
}

function validateMcpTool(value: unknown, fieldName: string): NonNullable<NonNullable<AppConfig["mcp"]>["servers"][number]["tools"]>[number] {
  const tool = requireRecord(value, fieldName);
  const category = requireString(tool.category, `${fieldName}.category`);

  if (!isMcpToolCategory(category)) {
    throw new InvalidConfigError(`${fieldName}.category must be read, local_write, external_write, public_action, destructive, money, or unknown.`);
  }

  return { name: requireString(tool.name, `${fieldName}.name`), category };
}

function isMcpToolCategory(value: string): value is McpToolCategory {
  return ["read", "local_write", "external_write", "public_action", "destructive", "money", "unknown"].includes(value);
}

function optionalChannels(value: unknown): AppConfig["channels"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const channels = requireRecord(value, "channels");
  const telegram = optionalTelegramChannel(channels.telegram);
  const zalo = optionalZaloChannel(channels.zalo);
  const zaloPersonal = optionalZaloPersonalChannel(channels.zaloPersonal);

  return {
    ...(telegram === undefined ? {} : { telegram }),
    ...(zalo === undefined ? {} : { zalo }),
    ...(zaloPersonal === undefined ? {} : { zaloPersonal }),
  };
}

function optionalZaloPersonalChannel(value: unknown): NonNullable<NonNullable<AppConfig["channels"]>["zaloPersonal"]> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const zaloPersonal = requireRecord(value, "channels.zaloPersonal");
  if (typeof zaloPersonal.enabled !== "boolean") {
    throw new InvalidConfigError("channels.zaloPersonal.enabled must be a boolean.");
  }

  const reconnect = zaloPersonal.reconnect === undefined ? undefined : requireRecord(zaloPersonal.reconnect, "channels.zaloPersonal.reconnect");
  const initialDelayMs = reconnect?.initialDelayMs === undefined ? undefined : optionalPositiveInteger(reconnect.initialDelayMs, "channels.zaloPersonal.reconnect.initialDelayMs");
  const maxDelayMs = reconnect?.maxDelayMs === undefined ? undefined : optionalPositiveInteger(reconnect.maxDelayMs, "channels.zaloPersonal.reconnect.maxDelayMs");
  if (initialDelayMs !== undefined && maxDelayMs !== undefined && initialDelayMs > maxDelayMs) {
    throw new InvalidConfigError("channels.zaloPersonal.reconnect.initialDelayMs must not exceed maxDelayMs.");
  }

  const enabled = zaloPersonal.enabled;
  const ownerUserId = requireOwnerUserId(zaloPersonal.ownerUserId, "channels.zaloPersonal.ownerUserId");
  if (enabled && !hasConfiguredOwner(ownerUserId)) {
    throw new InvalidConfigError("channels.zaloPersonal.ownerUserId must be set when Zalo Personal is enabled.");
  }

  return {
    enabled,
    sessionEnv: requireString(zaloPersonal.sessionEnv, "channels.zaloPersonal.sessionEnv"),
    ownerUserId,
    ...(zaloPersonal.adminUserIds === undefined ? {} : { adminUserIds: requireAdminUserIds(zaloPersonal.adminUserIds, "channels.zaloPersonal.adminUserIds") }),
    ...(initialDelayMs === undefined && maxDelayMs === undefined ? {} : { reconnect: { ...(initialDelayMs === undefined ? {} : { initialDelayMs }), ...(maxDelayMs === undefined ? {} : { maxDelayMs }) } }),
    ...(zaloPersonal.attachments === undefined ? {} : { attachments: optionalChannelAttachments(zaloPersonal.attachments, "channels.zaloPersonal.attachments") }),
  };
}

function optionalZaloChannel(value: unknown): NonNullable<NonNullable<AppConfig["channels"]>["zalo"]> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const zalo = requireRecord(value, "channels.zalo");
  const enabled = zalo.enabled;

  if (typeof enabled !== "boolean") {
    throw new InvalidConfigError("channels.zalo.enabled must be a boolean.");
  }

  return {
    enabled,
    botTokenEnv: requireString(zalo.botTokenEnv, "channels.zalo.botTokenEnv"),
    ownerUserId: requireOwnerUserId(zalo.ownerUserId, "channels.zalo.ownerUserId"),
    ...(zalo.adminUserIds === undefined ? {} : { adminUserIds: requireAdminUserIds(zalo.adminUserIds, "channels.zalo.adminUserIds") }),
    ...(zalo.pollingTimeoutSeconds === undefined ? {} : { pollingTimeoutSeconds: optionalPositiveInteger(zalo.pollingTimeoutSeconds, "channels.zalo.pollingTimeoutSeconds") }),
    ...(zalo.attachments === undefined ? {} : { attachments: optionalChannelAttachments(zalo.attachments, "channels.zalo.attachments") }),
  };
}

function optionalTelegramChannel(value: unknown): NonNullable<NonNullable<AppConfig["channels"]>["telegram"]> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const telegram = requireRecord(value, "channels.telegram");
  const enabled = telegram.enabled;
  const voiceReplyPolicy = telegram.voiceReplyPolicy;

  if (typeof enabled !== "boolean") {
    throw new InvalidConfigError("channels.telegram.enabled must be a boolean.");
  }

  if (voiceReplyPolicy !== undefined && voiceReplyPolicy !== "deny" && voiceReplyPolicy !== "voice-input-only") {
    throw new InvalidConfigError("channels.telegram.voiceReplyPolicy must be deny or voice-input-only.");
  }

  return {
    enabled,
    botTokenEnv: requireString(telegram.botTokenEnv, "channels.telegram.botTokenEnv"),
    ownerUserId: requireOwnerUserId(telegram.ownerUserId, "channels.telegram.ownerUserId"),
    ...(telegram.adminUserIds === undefined ? {} : { adminUserIds: requireAdminUserIds(telegram.adminUserIds, "channels.telegram.adminUserIds") }),
    ...(voiceReplyPolicy === undefined ? {} : { voiceReplyPolicy }),
    ...(telegram.voiceReplyMaxChars === undefined ? {} : { voiceReplyMaxChars: optionalPositiveInteger(telegram.voiceReplyMaxChars, "channels.telegram.voiceReplyMaxChars") }),
    ...(telegram.voiceReplyCooldownMs === undefined ? {} : { voiceReplyCooldownMs: optionalNonNegativeInteger(telegram.voiceReplyCooldownMs, "channels.telegram.voiceReplyCooldownMs") }),
    ...(telegram.attachments === undefined ? {} : { attachments: optionalChannelAttachments(telegram.attachments, "channels.telegram.attachments") }),
  };
}

function optionalChannelAttachments(value: unknown, fieldName: string): NonNullable<NonNullable<NonNullable<AppConfig["channels"]>["telegram"]>["attachments"]> {
  const attachments = requireRecord(value, fieldName);
  const downloadPolicy = attachments.downloadPolicy;
  const maxBytes = optionalPositiveInteger(attachments.maxBytes, `${fieldName}.maxBytes`);
  const previewMaxBytes = optionalPositiveInteger(attachments.previewMaxBytes, `${fieldName}.previewMaxBytes`);
  const parseMaxBytes = optionalPositiveInteger(attachments.parseMaxBytes, `${fieldName}.parseMaxBytes`);
  const visionPolicy = attachments.visionPolicy;
  const visionMaxBytes = optionalPositiveInteger(attachments.visionMaxBytes, `${fieldName}.visionMaxBytes`);
  const transcriptionPolicy = attachments.transcriptionPolicy;
  const transcriptionMaxBytes = optionalPositiveInteger(attachments.transcriptionMaxBytes, `${fieldName}.transcriptionMaxBytes`);
  const deleteAfterProcessingKinds = optionalChannelAttachmentKinds(attachments.deleteAfterProcessingKinds, `${fieldName}.deleteAfterProcessingKinds`);
  const allowedMimeTypes = attachments.allowedMimeTypes;

  if (downloadPolicy !== undefined && downloadPolicy !== "allow" && downloadPolicy !== "deny") {
    throw new InvalidConfigError(`${fieldName}.downloadPolicy must be allow or deny.`);
  }

  if (visionPolicy !== undefined && visionPolicy !== "allow" && visionPolicy !== "deny") {
    throw new InvalidConfigError(`${fieldName}.visionPolicy must be allow or deny.`);
  }

  if (transcriptionPolicy !== undefined && transcriptionPolicy !== "allow" && transcriptionPolicy !== "deny") {
    throw new InvalidConfigError(`${fieldName}.transcriptionPolicy must be allow or deny.`);
  }

  if (allowedMimeTypes !== undefined && (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.some((mimeType) => typeof mimeType !== "string" || mimeType.trim().length === 0))) {
    throw new InvalidConfigError(`${fieldName}.allowedMimeTypes must be an array of non-empty strings.`);
  }

  return {
    ...(downloadPolicy === undefined ? {} : { downloadPolicy }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(previewMaxBytes === undefined ? {} : { previewMaxBytes }),
    ...(parseMaxBytes === undefined ? {} : { parseMaxBytes }),
    ...(visionPolicy === undefined ? {} : { visionPolicy }),
    ...(visionMaxBytes === undefined ? {} : { visionMaxBytes }),
    ...(transcriptionPolicy === undefined ? {} : { transcriptionPolicy }),
    ...(transcriptionMaxBytes === undefined ? {} : { transcriptionMaxBytes }),
    ...(deleteAfterProcessingKinds === undefined ? {} : { deleteAfterProcessingKinds }),
    ...(allowedMimeTypes === undefined ? {} : { allowedMimeTypes }),
  };
}

function optionalChannelAttachmentKinds(value: unknown, fieldName: string): Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker"> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const validKinds = ["photo", "document", "voice", "audio", "video", "sticker"];
  if (!Array.isArray(value) || value.some((kind) => typeof kind !== "string" || !validKinds.includes(kind))) {
    throw new InvalidConfigError(`${fieldName} must be an array of Telegram attachment kinds.`);
  }

  return value as Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker">;
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new InvalidConfigError(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function optionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InvalidConfigError(`${fieldName} must be a non-negative integer.`);
  }

  return value;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidConfigError(`${fieldName} must be an object.`);
  }

  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidConfigError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new InvalidConfigError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function requireStringRecord(value: unknown, fieldName: string): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new InvalidConfigError(`${fieldName} must be an object with string values.`);
  }

  return value as Record<string, string>;
}

function requireOptionalString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new InvalidConfigError(`${fieldName} must be a string.`);
  }

  return value;
}

function requireOwnerUserId(value: unknown, fieldName: string): OwnerUserIdConfig {
  if (typeof value === "string") {
    const ownerUserId = value.trim();
    if (ownerUserId === "*") {
      throw new InvalidConfigError(`${fieldName} may use "*" only as the single array value ["*"].`);
    }
    return ownerUserId;
  }

  if (!Array.isArray(value) || value.length === 0 || value.some((ownerUserId) => typeof ownerUserId !== "string" || ownerUserId.trim().length === 0)) {
    throw new InvalidConfigError(`${fieldName} must be a string or a non-empty array of non-empty strings.`);
  }

  const ownerUserIds = value.map((ownerUserId) => ownerUserId.trim());
  if (ownerUserIds.includes("*") && (ownerUserIds.length !== 1 || ownerUserIds[0] !== "*")) {
    throw new InvalidConfigError(`${fieldName} may use "*" only as the single array value ["*"].`);
  }

  return ownerUserIds;
}

function requireAdminUserIds(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim() || item.trim() === "*")) {
    throw new InvalidConfigError(`${fieldName} must be a non-empty array of non-empty IDs and cannot include "*".`);
  }
  const ids = value.map((item) => item.trim());
  if (new Set(ids).size !== ids.length) {
    throw new InvalidConfigError(`${fieldName} must not contain duplicate IDs.`);
  }
  return ids;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidConfigError(`${fieldName} must be a boolean.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number") {
    throw new InvalidConfigError(`${fieldName} must be a number.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
