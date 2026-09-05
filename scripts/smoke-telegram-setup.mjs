import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runTelegramCommand } from "../dist/cli/commands/telegram.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";
import { createRuntimePaths } from "./runtime-paths.mjs";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-telegram-setup-smoke-"));
const paths = createRuntimePaths(rootDir);
const output = [];

try {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": {
            provider: "openai-compatible",
            mode: "api-key",
            baseUrl: "http://127.0.0.1:9/v1",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
        },
      },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);

  await runTelegramCommand({
    argv: ["node", "bestie", "channels", "telegram", "setup"],
    paths,
    questioner: {
      ask: async () => "",
      askHidden: async () => "test-telegram-token",
      confirm: async () => true,
      close: () => undefined,
    },
    clientFactory: () => ({
      getUpdates: async () => [{
        update_id: 1,
        message: { message_id: 10, date: 1, chat: { id: 12345, type: "private", first_name: "Quy" }, from: { id: 12345, is_bot: false, first_name: "Quy", last_name: "Nguyen", username: "quy_nguyen" }, text: "hi" },
      }],
      sendMessage: async () => undefined,
      editMessageText: async () => undefined,
      sendChatAction: async () => undefined,
      setMyCommands: async () => undefined,
    }),
    writeLine: (message) => output.push(message),
    useColor: false,
  });

  const configText = await readFile(paths.configPath, "utf8");
  const envText = await readFile(paths.envPath, "utf8");

  assertIncludes(configText, '"telegram"');
  assertIncludes(configText, '"ownerUserId": "12345"');
  assertIncludes(envText, 'BESTIE_TELEGRAM_BOT_TOKEN="test-telegram-token"');
  const outputText = output.join("\n");
  assertIncludes(outputText, "Bot token");
  assertIncludes(outputText, "Nội dung nhập sẽ được ẩn");
  assertIncludes(outputText, "Đã nhận tin nhắn từ Quy Nguyen");
  assertIncludes(outputText, "Đã xác nhận chủ sở hữu: Quy Nguyen");
  assertIncludes(outputText, "Đã lưu cấu hình Telegram");
  assertNotIncludes(outputText, "test-telegram-token");
  console.log("Telegram setup smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}


function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}

function assertNotIncludes(value, unexpected) {
  if (value.includes(unexpected)) {
    throw new Error(`Expected output not to include ${unexpected}`);
  }
}
