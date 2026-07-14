import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ZaloHttpClient, runZaloPollingLoop, type ZaloChatCompletionRunner, type ZaloClient } from "../../channels/zalo.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

const DEFAULT_ZALO_TOKEN_ENV = "BESTIE_ZALO_BOT_TOKEN";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_MAGENTA = "\x1b[35m";

type AskLine = (question: string) => Promise<string>;

interface ZaloQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  close: () => void;
}

interface ZaloCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: ZaloQuestioner;
  clientFactory?: (token: string) => ZaloClient;
  chatCompletion?: ZaloChatCompletionRunner;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

interface ZaloSetupUi {
  intro: (paths: RuntimePaths) => void;
  section: (title: string, detail?: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  savedPath: (label: string, path: string) => void;
  final: () => void;
}

export async function runZaloCommand(optionsOrArgv: string[] | ZaloCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (argv.includes("setup")) {
    await runZaloSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  const config = await loadConfig(paths);
  const zalo = config.channels?.zalo;

  if (!zalo?.enabled) {
    throw new UserFacingError("Zalo is not enabled. Run `bestie zalo setup` first.", "ZaloNotEnabledError");
  }

  const envValues = await loadEnvFile(paths);
  const token = process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv];

  if (!token) {
    throw new UserFacingError(`Zalo bot token env ${zalo.botTokenEnv} is missing. Add it to .bestie/.env.`, "ZaloMissingTokenError");
  }

  if (!zalo.ownerUserId.trim()) {
    throw new UserFacingError("Zalo owner user id is missing. Set channels.zalo.ownerUserId in .bestie/config.json.", "ZaloMissingOwnerError");
  }

  const client = options.clientFactory?.(token) ?? new ZaloHttpClient(token);
  writeLine(argv.includes("--once") ? "Zalo polling once." : "Zalo polling started. Press Ctrl+C to stop.");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runZaloPollingLoop({ config, paths, client, once: argv.includes("--once"), shouldStop: () => stopping, chatCompletion: options.chatCompletion });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function runZaloSetup(options: { paths: RuntimePaths; questioner?: ZaloQuestioner; writeLine: (message: string) => void; useColor?: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const ui = createZaloSetupUi(options.writeLine, options.useColor ?? output.isTTY);

  try {
    ui.intro(options.paths);
    ui.section("Account", "Connect one Zalo bot to this local runtime.");
    const config = await loadConfig(options.paths);
    const ownerUserId = (await questioner.ask("[1/2] Owner Zalo user id allowed to chat with Bestie: ")).trim();
    const token = await questioner.askHidden("[2/2] Bot token Paste the Zalo Bot Token. It is hidden while typing: ");

    if (!ownerUserId) {
      throw new UserFacingError("Zalo owner user id is required.", "ZaloMissingOwnerError");
    }

    if (!token.trim()) {
      throw new UserFacingError("Zalo bot token is required.", "ZaloMissingTokenError");
    }

    ui.success("Zalo owner and bot token collected.");
    ui.section("Save", "Updating local config and secret env file.");
    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(enableZaloConfig(config, ownerUserId), options.paths);
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_ZALO_TOKEN_ENV]: token.trim() }, options.paths);

    ui.success("Zalo setup saved.");
    ui.section("Files", "Secrets stay local and are not printed.");
    ui.savedPath("Config", options.paths.configPath);
    ui.savedPath("Token env", `${DEFAULT_ZALO_TOKEN_ENV} in ${options.paths.envPath}`);
    ui.info("Zalo is enabled for the configured owner user id only.");
    ui.final();
  } finally {
    questioner.close();
  }
}

function enableZaloConfig(config: AppConfig, ownerUserId: string): AppConfig {
  return {
    ...config,
    channels: {
      ...config.channels,
      zalo: {
        enabled: true,
        botTokenEnv: DEFAULT_ZALO_TOKEN_ENV,
        ownerUserId,
      },
    },
  };
}

function createZaloSetupUi(writeLine: (message: string) => void, useColor: boolean): ZaloSetupUi {
  const paint = (text: string, code: string) => useColor ? `${code}${text}${ANSI_RESET}` : text;
  const dim = (text: string) => paint(text, ANSI_DIM);
  const accent = (text: string) => paint(text, ANSI_CYAN);
  const ok = (text: string) => paint(text, ANSI_GREEN);
  const title = (text: string) => useColor ? `${ANSI_BOLD}${ANSI_MAGENTA}${text}${ANSI_RESET}` : text;

  return {
    intro: (paths) => {
      writeLine(title("Zalo setup"));
      writeLine(dim("Connect a Zalo bot to your local Bestie runtime."));
      writeLine(`${accent("Runtime")} ${paths.appDir}`);
      writeLine(`${accent("Privacy")} Bot tokens stay local in .bestie/.env and are hidden while typing.`);
      writeLine(`${dim("Plan")} Account -> Save -> Files\n`);
    },
    section: (sectionTitle, detail) => writeLine(`${accent("\n>")} ${paint(sectionTitle, ANSI_BOLD)}${detail ? ` ${dim(detail)}` : ""}`),
    success: (message) => writeLine(`${ok("OK")} ${message}`),
    info: (message) => writeLine(`${paint("INFO", ANSI_YELLOW)} ${message}`),
    savedPath: (label, path) => writeLine(`  ${accent(label.padEnd(10))} ${path}`),
    final: () => {
      writeLine(`${ok("\nDone")} Zalo setup complete.`);
      writeLine(`${dim("Next")} Run \`bestie doctor\`, then \`bestie zalo --once\`.`);
    },
  };
}

function createQuestioner(): ZaloQuestioner {
  const rl = createInterface({ input, output });
  return {
    ask: (question) => rl.question(question),
    askHidden: async (question) => rl.question(question),
    close: () => rl.close(),
  };
}