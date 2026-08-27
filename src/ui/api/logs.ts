import { readRecentLogs } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiLogsSummary {
  ok: true;
  lines: string[];
  count: number;
}

export async function getUiLogsSummary(options: { lines?: number; paths?: RuntimePaths } = {}): Promise<UiLogsSummary> {
  const lineCount = Number.isInteger(options.lines) ? Math.min(Math.max(options.lines ?? 80, 1), 500) : 80;
  const lines = await readRecentLogs(options.paths ?? getRuntimePaths(), lineCount);
  return { ok: true, lines, count: lines.length };
}
