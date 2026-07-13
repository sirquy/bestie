import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getRuntimePaths, type RuntimePaths } from "./paths.js";
import { redactSecretLikeValues } from "./secret-redaction.js";

export interface LogEvent {
  event: string;
  detail?: Record<string, unknown>;
}

export function redactSecrets(input: unknown, knownSecrets: string[] = []): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return redactSecretLikeValues(text, knownSecrets);
}

export async function appendLog(
  logEvent: LogEvent,
  options: { paths?: RuntimePaths; knownSecrets?: string[] } = {},
): Promise<void> {
  const paths = options.paths ?? getRuntimePaths();
  await mkdir(paths.logsDir, { recursive: true });

  const line = redactSecrets(
    {
      timestamp: new Date().toISOString(),
      ...logEvent,
    },
    options.knownSecrets,
  );

  await writeFile(paths.appLogPath, `${line}\n`, { flag: "a", mode: 0o600 });
}

export async function readRecentLogs(paths: RuntimePaths = getRuntimePaths(), lineCount = 40): Promise<string[]> {
  let logText = "";

  try {
    logText = await readFile(paths.appLogPath, "utf8");
  } catch {
    return [];
  }

  return logText.trimEnd().split(/\r?\n/).slice(-lineCount);
}