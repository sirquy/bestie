import { INTERNAL_TOOL_NAMES } from "../chat/mcp-tool-use.js";
import type { AppConfig, InternalToolPolicy } from "./config.js";
import type { RuntimePaths } from "./paths.js";

const DEFAULT_ATTACHMENT_SETTINGS = {
  downloadPolicy: "allow" as const,
  maxBytes: 20 * 1024 * 1024,
  previewMaxBytes: 16 * 1024,
  parseMaxBytes: 5 * 1024 * 1024,
  visionPolicy: "allow" as const,
  visionMaxBytes: 4 * 1024 * 1024,
  transcriptionPolicy: "allow" as const,
  transcriptionMaxBytes: 10 * 1024 * 1024,
  deleteAfterProcessingKinds: [] as Array<"photo" | "document" | "voice" | "audio" | "video" | "sticker">,
};

export function getOnboardingConfigDefaults(paths: RuntimePaths): Pick<AppConfig, "memory" | "workspace" | "internalTools" | "channels" | "mcp" | "skills"> {
  return {
    memory: {
      writePolicy: "allow",
      deletePolicy: "allow",
      retrievalPolicy: "governed",
      recentMessageLimit: 20,
    },
    workspace: {
      defaultPath: paths.workspaceDir,
      externalPaths: [],
    },
    internalTools: {
      policies: Object.fromEntries(INTERNAL_TOOL_NAMES.map((tool) => [tool, "allow" as InternalToolPolicy])),
      exec: { timeoutMs: 300_000 },
      browser: { cdpEndpoint: "http://127.0.0.1:9222" },
    },
    channels: {
      telegram: { enabled: false, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "", attachments: { ...DEFAULT_ATTACHMENT_SETTINGS } },
      zalo: { enabled: false, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "", pollingTimeoutSeconds: 25, attachments: { ...DEFAULT_ATTACHMENT_SETTINGS } },
      zaloPersonal: { enabled: false, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "", reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000 }, attachments: { ...DEFAULT_ATTACHMENT_SETTINGS } },
    },
    mcp: { servers: [] },
    skills: {
      registry: {
        remoteOfficial: {
          enabled: true,
          url: "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.json",
          checksumUrl: "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.sha256",
          installPolicy: "ask",
        },
      },
    },
  };
}

export function completeOnboardingConfig(config: AppConfig, paths: RuntimePaths): AppConfig {
  const defaults = getOnboardingConfigDefaults(paths);
  return {
    ...config,
    memory: { ...defaults.memory, ...config.memory },
    workspace: { ...defaults.workspace, ...config.workspace },
    internalTools: {
      ...defaults.internalTools,
      ...config.internalTools,
      policies: { ...defaults.internalTools?.policies, ...config.internalTools?.policies },
      exec: { ...defaults.internalTools?.exec, ...config.internalTools?.exec },
      browser: { ...defaults.internalTools?.browser, ...config.internalTools?.browser },
    },
    channels: { ...defaults.channels, ...config.channels },
    mcp: config.mcp ? { ...config.mcp } : defaults.mcp,
    skills: { ...defaults.skills, ...config.skills },
  };
}
