import { UserFacingError } from "../../runtime/errors.js";
import { badge } from "../ui.js";
import { startUiServer } from "../../ui/server.js";
import { UiAuthService } from "../../ui/auth.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { getTunnelStatus, revokeTunnel, setupTunnel, startTunnelConnector, stopTunnelConnector } from "../../ui/tunnel/lifecycle.js";

const CLIENT_VERSION = "0.1.39";

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
  if (argv[3] === "tunnel") {
    await runTunnelCommand(argv, writeLine);
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

async function runTunnelCommand(argv: string[], writeLine: (message: string) => void): Promise<void> {
  const action = argv[4] ?? "status";
  const paths = getRuntimePaths();
  if (readFlagValue(argv, "--port") && readFlagValue(argv, "--port") !== "8787") {
    throw new UserFacingError("Tunnel control plane chỉ proxy tới UI origin cố định http://127.0.0.1:8787.", "UiTunnelOriginFixed");
  }
  const options = { paths, clientVersion: CLIENT_VERSION };

  if (action === "setup") {
    const state = await setupTunnel(options);
    writeLine(`${badge("TUNNEL", "green")} Đã cấp URL remote cho Bestie UI.`);
    writeLine(`URL: ${state.tunnel.url}`);
    writeLine("Connector Cloudflare chưa được khởi động trong milestone này.");
    return;
  }
  if (action === "status") {
    const state = await getTunnelStatus(options);
    if (!state) {
      writeLine(`${badge("INFO", "blue")} Chưa cấu hình tunnel. Chạy 'bestie ui tunnel setup'.`);
      return;
    }
    writeLine(`${badge("TUNNEL", state.tunnel.status === "ONLINE" ? "green" : "yellow")} ${state.tunnel.status === "ONLINE" ? "Tunnel đang online" : "Tunnel đã cấp nhưng chưa kết nối"}.`);
    writeLine(`URL: ${state.tunnel.url}`);
    writeLine(`Cập nhật: ${state.tunnel.updatedAt}`);
    return;
  }
  if (action === "start") {
    const state = await startTunnelConnector(options);
    writeLine(`${badge("TUNNEL", "green")} Connector Cloudflare đã khởi động.`);
    writeLine(`URL: ${state.tunnel.url}`);
    writeLine(`PID: ${state.connector?.pid}`);
    return;
  }
  if (action === "stop") {
    const state = await stopTunnelConnector(options);
    writeLine(`${badge("STOP", "gray")} Connector Cloudflare đã dừng.`);
    writeLine(`URL được giữ lại: ${state.tunnel.url}`);
    return;
  }
  if (action === "revoke") {
    const hostname = await revokeTunnel(options);
    writeLine(`${badge("STOP", "gray")} Đã revoke ${hostname}.`);
    return;
  }

  throw new UserFacingError("Cách dùng: bestie ui tunnel setup|start|stop|status|revoke", "UiTunnelUsageError");
}