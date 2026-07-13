import { readRecentLogs } from "../../runtime/logger.js";
import { getRuntimePaths } from "../../runtime/paths.js";

export async function runLogsCommand(): Promise<void> {
  const paths = getRuntimePaths();
  const lines = await readRecentLogs(paths);

  if (lines.length === 0) {
    console.log(`No logs found yet. Logs will be written to ${paths.appLogPath}.`);
    return;
  }

  for (const line of lines) {
    console.log(line);
  }
}