import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import qrCodeTerminal from "qrcode-terminal";

import { ZaloPersonalClient } from "../../channels/zalo-personal/client.js";
import { runZaloPersonalMonitor } from "../../channels/zalo-personal/monitor.js";
import { decodeZaloPersonalSession, encodeZaloPersonalSession } from "../../channels/zalo-personal/session.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, dim, title } from "../ui.js";

const DEFAULT_ZALO_PERSONAL_SESSION_ENV = "BESTIE_ZALO_PERSONAL_SESSION";

interface ZaloPersonalQuestioner {
  ask(question: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  close(): void;
}

interface ZaloPersonalCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: ZaloPersonalQuestioner;
  clientFactory?: (session: string) => Promise<ZaloPersonalClient>;
  loginWithQr?: typeof ZaloPersonalClient.loginWithQr;
  writeLine?: (message: string) => void;
}

export async function runZaloPersonalCommand(optionsOrArgv: string[] | ZaloPersonalCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const subcommand = argv[4] ?? (argv.includes("--once") ? "run" : undefined);

  if (subcommand === "setup") {
    await runZaloPersonalSetup({ paths, questioner: options.questioner, loginWithQr: options.loginWithQr, writeLine });
    return;
  }
  if (subcommand === "login") {
    await loginAndSaveSession({ paths, loginWithQr: options.loginWithQr, writeLine });
    return;
  }
  if (subcommand === "logout") {
    await logoutZaloPersonal(paths, writeLine);
    return;
  }
  if (subcommand === "status") {
    await showZaloPersonalStatus(paths, writeLine, argv.includes("--connect"), options.clientFactory);
    return;
  }
  if (subcommand && subcommand !== "run" && !subcommand.startsWith("--")) {
    throw new UserFacingError("Cách dùng: bestie channels zalo-personal [setup|login|logout|status|--once]", "ZaloPersonalUsageError");
  }

  const config = await loadConfig(paths);
  const personal = config.channels?.zaloPersonal;
  if (!personal?.enabled) throw new UserFacingError("Zalo Personal chưa được bật. Hãy chạy `bestie channels zalo-personal setup`.", "ZaloPersonalNotEnabledError");
  if (!personal.ownerUserId.trim()) throw new UserFacingError("Thiếu controller Zalo Personal. Chạy lại `bestie channels zalo-personal setup`.", "ZaloPersonalMissingOwnerError");
  const session = await loadZaloPersonalSession(paths, personal.sessionEnv);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  writeLine(argv.includes("--once") ? "Zalo Personal đang kiểm tra phiên một lần." : "Zalo Personal đang lắng nghe. Nhấn Ctrl+C để dừng.");
  try {
    if (argv.includes("--once")) {
      await (options.clientFactory?.(session) ?? restoreZaloPersonalClient(session));
      return;
    }
    await runZaloPersonalMonitor({
      config,
      paths,
      shouldStop: () => stopping,
      createClient: () => options.clientFactory?.(session) ?? restoreZaloPersonalClient(session),
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function runZaloPersonalSetup(options: { paths: RuntimePaths; questioner?: ZaloPersonalQuestioner; loginWithQr?: typeof ZaloPersonalClient.loginWithQr; writeLine: (message: string) => void }): Promise<void> {
  const questioner = options.questioner ?? createCliQuestioner();
  try {
    options.writeLine(title("Thiết lập Zalo Personal"));
    options.writeLine(dim("Experimental/unofficial: tự động hóa tài khoản cá nhân có thể khiến tài khoản bị giới hạn hoặc khóa."));
    options.writeLine(dim("Dùng một tài khoản automation riêng và một tài khoản Zalo khác làm controller; tin nhắn từ chính automation account luôn bị bỏ qua."));
    if (!await questioner.confirm("Bạn chấp nhận rủi ro tài khoản và sẽ dùng tài khoản automation riêng?", false)) {
      throw new UserFacingError("Đã hủy thiết lập Zalo Personal.", "ZaloPersonalSetupDeclinedError");
    }
    const sessionEnv = DEFAULT_ZALO_PERSONAL_SESSION_ENV;
    const { client } = await loginAndSaveSession({ paths: options.paths, sessionEnv, loginWithQr: options.loginWithQr, writeLine: options.writeLine });
    const controllerId = await waitForZaloPersonalController(client, questioner, options.writeLine);
    const config = await loadConfig(options.paths);
    await writeConfig(enableZaloPersonalConfig(config, controllerId, sessionEnv), options.paths);
    options.writeLine(`${badge("OK", "green")} Đã bật Zalo Personal cho controller đã cấu hình.`);
    options.writeLine(`Chạy [36mbestie channels zalo-personal[0m hoặc [36mbestie daemon start --channel zalo-personal[0m để bắt đầu.`);
  } finally {
    questioner.close();
  }
}

async function loginAndSaveSession(options: { paths: RuntimePaths; sessionEnv?: string; loginWithQr?: typeof ZaloPersonalClient.loginWithQr; writeLine: (message: string) => void }): Promise<{ client: ZaloPersonalClient }> {
  const config = await loadConfig(options.paths);
  const sessionEnv = options.sessionEnv ?? config.channels?.zaloPersonal?.sessionEnv ?? DEFAULT_ZALO_PERSONAL_SESSION_ENV;
  const qrPath = resolve(options.paths.dataDir, `zalo-personal-qr-${process.pid}.png`);
  await mkdir(options.paths.dataDir, { recursive: true, mode: 0o700 });
  const abortController = new AbortController();
  const abortLogin = () => abortController.abort();
  process.once("SIGINT", abortLogin);
  process.once("SIGTERM", abortLogin);
  try {
    options.writeLine("Đang tạo QR Zalo Personal. Quét QR bằng tài khoản automation; QR chỉ được lưu tạm trên máy này.");
    const login = options.loginWithQr ?? ZaloPersonalClient.loginWithQr;
    let client: ZaloPersonalClient;
    let credentials;
    try {
      ({ client, credentials } = await login({
        qrPath,
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.type === 0) {
            options.writeLine("Quét QR này bằng tài khoản automation:");
            if (event.data?.code) qrCodeTerminal.generate(event.data.code, { small: true }, options.writeLine);
            options.writeLine(`QR cũng được lưu tạm tại ${qrPath}.`);
          }
          if (event.type === 2) options.writeLine("QR đã được quét; đang hoàn tất đăng nhập.");
          if (event.type === 1) options.writeLine("QR đã hết hạn; Zalo đang yêu cầu tạo lại QR.");
          if (event.type === 3) options.writeLine("QR đã bị từ chối; đăng nhập đã dừng và không có session nào được lưu.");
        },
      }));
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new UserFacingError("Đã hủy đăng nhập Zalo Personal; không có session nào được lưu.", "ZaloPersonalLoginCancelledError");
      }
      if (error instanceof Error && error.message === "Zalo QR login was declined.") {
        throw new UserFacingError("Đăng nhập Zalo Personal đã bị từ chối; không có session nào được lưu.", "ZaloPersonalLoginDeclinedError");
      }
      throw error;
    }
    const envValues = await loadEnvFile(options.paths);
    await writeEnvFile({ ...envValues, [sessionEnv]: encodeZaloPersonalSession(credentials) }, options.paths);
    options.writeLine(`${badge("OK", "green")} Đã lưu Zalo Personal session vào ${sessionEnv} trong .bestie/.env.`);
    return { client };
  } finally {
    process.off("SIGINT", abortLogin);
    process.off("SIGTERM", abortLogin);
    await rm(qrPath, { force: true });
  }
}

async function waitForZaloPersonalController(client: ZaloPersonalClient, questioner: ZaloPersonalQuestioner, writeLine: (message: string) => void): Promise<string> {
  writeLine("Từ tài khoản controller, hãy gửi bất kỳ tin nhắn riêng nào cho tài khoản automation vừa quét QR.");
  writeLine(dim("Bestie sẽ tự nhận diện ID controller; tin nhắn từ chính automation account và tin nhắn nhóm bị bỏ qua."));

  let detach = () => {};
  let settled = false;
  let prompting = false;
  try {
    return await new Promise<string>((resolveController, rejectController) => {
      const reject = (error: Error) => {
        if (settled) return;
        settled = true;
        rejectController(error);
      };
      detach = client.startListening({
        onMessage: (message) => {
          if (settled || prompting || message.isSelf || message.type !== 0) return;
          const controllerId = message.data.uidFrom?.trim();
          if (!controllerId) return;

          prompting = true;
          void client.getUserDisplayName(controllerId)
            .catch(() => undefined)
            .then((displayName) => questioner.confirm(`Đã nhận tin nhắn từ ${displayName ? `${displayName} (Zalo ID: ${controllerId})` : `Zalo ID: ${controllerId}`}. Đây có phải tài khoản controller của bạn?`, true))
            .then((confirmed) => {
              if (settled) return;
              if (confirmed) {
                settled = true;
                resolveController(controllerId);
                return;
              }
              writeLine("Chưa xác nhận tài khoản này. Hãy gửi tin nhắn từ đúng tài khoản controller.");
            })
            .catch((error: unknown) => reject(error instanceof Error ? error : new Error("Không thể xác nhận tài khoản controller Zalo Personal.")))
            .finally(() => { prompting = false; });
        },
        onError: () => reject(new UserFacingError("Không thể lắng nghe tin nhắn để nhận diện controller. Hãy đăng nhập lại và thử setup lại.", "ZaloPersonalControllerDetectionError")),
        onClosed: () => reject(new UserFacingError("Kết nối Zalo đóng trước khi nhận diện controller. Hãy thử setup lại.", "ZaloPersonalControllerDetectionClosedError")),
      });
    });
  } finally {
    detach();
  }
}

async function logoutZaloPersonal(paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const sessionEnv = config.channels?.zaloPersonal?.sessionEnv ?? DEFAULT_ZALO_PERSONAL_SESSION_ENV;
  const envValues = await loadEnvFile(paths);
  delete envValues[sessionEnv];
  await writeEnvFile(envValues, paths);
  await writeConfig({ ...config, channels: { ...config.channels, zaloPersonal: config.channels?.zaloPersonal ? { ...config.channels.zaloPersonal, enabled: false } : undefined } }, paths);
  writeLine(`${badge("OK", "green")} Đã xóa session cục bộ và tắt Zalo Personal.`);
}

async function showZaloPersonalStatus(paths: RuntimePaths, writeLine: (message: string) => void, connect: boolean, clientFactory?: (session: string) => Promise<ZaloPersonalClient>): Promise<void> {
  const config = await loadConfig(paths);
  const personal = config.channels?.zaloPersonal;
  const sessionPresent = personal ? await hasZaloPersonalSession(paths, personal.sessionEnv) : false;
  writeLine(title("Zalo Personal"));
  writeLine(`Enabled: ${personal?.enabled === true ? "yes" : "no"}`);
  writeLine(`Controller configured: ${personal?.ownerUserId ? "yes" : "no"}`);
  writeLine(`Session present: ${sessionPresent ? "yes" : "no"}`);
  writeLine("Transport: experimental/unofficial; account restrictions are possible.");
  if (connect && personal && sessionPresent) {
    await (clientFactory?.(await loadZaloPersonalSession(paths, personal.sessionEnv)) ?? restoreZaloPersonalClient(await loadZaloPersonalSession(paths, personal.sessionEnv)));
    writeLine("Session restore: successful.");
  }
}

function enableZaloPersonalConfig(config: AppConfig, ownerUserId: string, sessionEnv: string): AppConfig {
  return { ...config, channels: { ...config.channels, zaloPersonal: { enabled: true, sessionEnv, ownerUserId } } };
}

async function hasZaloPersonalSession(paths: RuntimePaths, sessionEnv: string): Promise<boolean> {
  const envValues = await loadEnvFile(paths);
  return Boolean(process.env[sessionEnv] ?? envValues[sessionEnv]);
}

async function loadZaloPersonalSession(paths: RuntimePaths, sessionEnv: string): Promise<string> {
  const envValues = await loadEnvFile(paths);
  const value = process.env[sessionEnv] ?? envValues[sessionEnv];
  if (!value) throw new UserFacingError(`Thiếu session Zalo Personal (${sessionEnv}). Hãy chạy [36mbestie channels zalo-personal login[0m.`, "ZaloPersonalMissingSessionError");
  return value;
}

async function restoreZaloPersonalClient(session: string): Promise<ZaloPersonalClient> {
  return ZaloPersonalClient.restore(decodeZaloPersonalSession(session).credentials);
}
