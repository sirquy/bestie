import { readFile, writeFile } from "node:fs/promises";

import { MissingSecretError } from "./errors.js";
import { getRuntimePaths, type RuntimePaths } from "./paths.js";

export type EnvValues = Record<string, string>;

export async function loadEnvFile(paths: RuntimePaths = getRuntimePaths()): Promise<EnvValues> {
  let envText = "";

  try {
    envText = await readFile(paths.envPath, "utf8");
  } catch {
    return {};
  }

  return parseEnv(envText);
}

export async function writeEnvFile(values: EnvValues, paths: RuntimePaths = getRuntimePaths()): Promise<void> {
  const envText = `${Object.entries(values)
    .map(([key, value]) => `${serializeEnvKey(key)}=${JSON.stringify(value)}`)
    .join("\n")}\n`;

  await writeFile(paths.envPath, envText, { mode: 0o600 });
}

export async function loadRequiredSecret(envVarName: string, paths: RuntimePaths = getRuntimePaths()): Promise<string> {
  const envValues = await loadEnvFile(paths);
  const value = envValues[envVarName] ?? process.env[envVarName];

  if (!value) {
    throw new MissingSecretError(envVarName, paths.envPath);
  }

  return value;
}

export function parseEnv(envText: string): EnvValues {
  const values: EnvValues = {};

  for (const line of envText.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (key) {
      values[key] = unquoteEnvValue(value);
    }
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function serializeEnvKey(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env var name: ${key}`);
  }

  return key;
}
