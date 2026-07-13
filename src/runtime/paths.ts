import { resolve } from "node:path";

export interface RuntimePaths {
  rootDir: string;
  appDir: string;
  configPath: string;
  envPath: string;
  characterPath: string;
  systemPromptPath: string;
  logsDir: string;
  appLogPath: string;
  dataDir: string;
  memoryDbPath: string;
  workspaceDir: string;
}

export function getRuntimePaths(rootDir = process.cwd()): RuntimePaths {
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  const workspaceDir = resolve(appDir, "workspace");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir,
  };
}