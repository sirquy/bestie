import { loadConfig, validateConfig, writeConfig, type AppConfig, type MemoryWritePolicy } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiSettingsSummary {
  ok: true;
  agent: {
    name: string;
    ownerName: string;
    language: string;
    timeZone?: string;
    toneIntensity: number;
  };
  memory: {
    writePolicy: MemoryWritePolicy;
  };
  workspace: {
    defaultPath?: string;
    externalPathCount: number;
  };
  llm: {
    primary: string;
    fallbackCount: number;
    authProfile: string;
    profileCount: number;
    modelCount: number;
  };
}

export interface UiSettingsUpdateOptions {
  confirm: boolean;
  agent?: {
    name?: string;
    ownerName?: string;
    language?: string;
    toneIntensity?: number;
  };
  memory?: {
    writePolicy?: MemoryWritePolicy;
  };
  paths?: RuntimePaths;
}

export async function getUiSettingsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiSettingsSummary> {
  return toUiSettingsSummary(await loadConfig(paths));
}

export async function updateUiSettings(options: UiSettingsUpdateOptions): Promise<UiSettingsSummary> {
  if (!options.confirm) {
    throw new Error("Settings updates require confirm=true.");
  }

  const paths = options.paths ?? getRuntimePaths();
  const config = await loadConfig(paths);
  const nextConfig = validateConfig({
    ...config,
    agent: {
      ...config.agent,
      ...(options.agent?.name === undefined ? {} : { name: options.agent.name }),
      ...(options.agent?.ownerName === undefined ? {} : { ownerName: options.agent.ownerName }),
      ...(options.agent?.language === undefined ? {} : { language: options.agent.language }),
      ...(options.agent?.toneIntensity === undefined ? {} : { toneIntensity: options.agent.toneIntensity }),
    },
    memory: {
      ...(config.memory ?? {}),
      ...(options.memory?.writePolicy === undefined ? {} : { writePolicy: options.memory.writePolicy }),
    },
  });

  await writeConfig(nextConfig, paths);
  return toUiSettingsSummary(nextConfig);
}

function toUiSettingsSummary(config: AppConfig): UiSettingsSummary {
  return {
    ok: true,
    agent: {
      name: config.agent.name,
      ownerName: config.agent.ownerName,
      language: config.agent.language,
      ...(config.agent.timeZone ? { timeZone: config.agent.timeZone } : {}),
      toneIntensity: config.agent.toneIntensity,
    },
    memory: {
      writePolicy: config.memory?.writePolicy ?? "ask",
    },
    workspace: {
      ...(config.workspace?.defaultPath ? { defaultPath: config.workspace.defaultPath } : {}),
      externalPathCount: config.workspace?.externalPaths?.length ?? 0,
    },
    llm: {
      primary: config.llm.primary,
      fallbackCount: config.llm.fallbacks?.length ?? 0,
      authProfile: config.llm.authProfile,
      profileCount: Object.keys(config.llm.profiles).length,
      modelCount: Object.keys(config.llm.modelCatalog).length,
    },
  };
}