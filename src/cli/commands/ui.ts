import { UserFacingError } from "../../runtime/errors.js";
import { badge } from "../ui.js";
import { startUiServer } from "../../ui/server.js";
import { UiAuthService } from "../../ui/auth.js";
import { getRuntimePaths } from "../../runtime/paths.js";

interface UiCommandOptions {
  argv?: string[];
  runUntilReady?: boolean;
  writeLine?: (message: string) => void;
}

export async function runUiCommand(optionsOrArgv: string[] | UiCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const writeLine = options.writeLine ?? console.log;
  if (argv[3] === "auth" && argv[4] === "reset") {
    const removed = await new UiAuthService(getRuntimePaths()).reset();
    writeLine(removed ? `${badge("OK", "green")} Đã xóa mã mở khóa UI. Mở Bestie UI để tạo mã mới.` : `${badge("INFO", "blue")} Chưa có mã mở khóa UI để xóa.`);
    return;
  }
  const host = readFlagValue(argv, "--host") ?? "127.0.0.1";
  const port = parsePort(readFlagValue(argv, "--port") ?? "8787");
  const openBrowser = !argv.includes("--no-open");

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new UserFacingError("UI chỉ bind localhost trong milestone đầu. Dùng --host 127.0.0.1.", "UiHostNotAllowed");
  }

  const server = await startUiServer({ host, port });
  writeLine(`${badge("UI", "green")} Bestie UI đang chạy tại ${server.url}`);
  writeLine(openBrowser ? "Mở trình duyệt tự động sẽ được thêm ở milestone sau." : "Giữ server chạy; nhấn Ctrl+C để dừng.");

  if (options.runUntilReady) {
    await server.close();
  }
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
}

function parsePort(rawValue: string): number {
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new UserFacingError("Port UI phải là số nguyên từ 0 đến 65535.", "UiInvalidPort");
  }

  return port;
}