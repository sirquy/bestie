import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { isTelegramToolProgressText, runTelegramCommand } from "./telegram.js";
import { runVoiceCommand } from "./voice.js";

test("runTelegramCommand setup writes Telegram config and token env", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let closed = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "setup"],
      paths,
      questioner: {
        ask: async () => "",
        askHidden: async () => "telegram-secret-token",
        confirm: async () => true,
        close: () => {
          closed = true;
        },
      },
      clientFactory: () => ({
        async getUpdates() {
          return [{ update_id: 1, message: { message_id: 10, date: 1, chat: { id: 12345, type: "private", first_name: "Boss" }, from: { id: 12345, is_bot: false, first_name: "Quy", last_name: "Nguyen", username: "boss_user" }, text: "hi" } }];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      }),
      writeLine: (message) => output.push(message),
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      channels?: { telegram?: { enabled: boolean; botTokenEnv: string; ownerUserId: string } };
    };
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(closed, true);
    assert.equal(config.channels?.telegram?.enabled, true);
    assert.equal(config.channels?.telegram?.botTokenEnv, "BESTIE_TELEGRAM_BOT_TOKEN");
    assert.equal(config.channels?.telegram?.ownerUserId, "12345");
    assert.match(envText, /OPENAI_API_KEY="sk-test"/);
    assert.match(envText, /BESTIE_TELEGRAM_BOT_TOKEN="telegram-secret-token"/);
    assert.ok(output.some((line) => line.includes("Thiết lập Telegram")));
    assert.ok(output.some((line) => line.includes("Runtime")));
    assert.ok(output.some((line) => line.includes("Bot token") && line.includes("Nội dung nhập sẽ được ẩn")));
    assert.ok(output.some((line) => line.includes("Đã nhận tin nhắn từ Quy Nguyen") && line.includes("12345")));
    assert.ok(output.some((line) => line.includes("Đã xác nhận chủ sở hữu: Quy Nguyen")));
    assert.ok(output.some((line) => line.includes("Đã lưu cấu hình Telegram")));
    assert.ok(output.some((line) => line.includes("Token env") && line.includes("BESTIE_TELEGRAM_BOT_TOKEN")));
    assert.ok(output.some((line) => line.includes("DONE") && line.includes("Thiết lập Telegram đã hoàn tất")));
    assert.ok(output.every((line) => !line.includes("telegram-secret-token")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand setup continues after an unconfirmed Telegram sender", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let pollCount = 0;
  const confirmations: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "setup"],
      paths,
      questioner: {
        ask: async () => "",
        askHidden: async () => "telegram-secret-token",
        confirm: async (question, defaultValue) => {
          confirmations.push(question);
          assert.equal(defaultValue, true);
          return confirmations.length > 1;
        },
        close: () => undefined,
      },
      clientFactory: () => ({
        async getUpdates() {
          pollCount += 1;
          return pollCount === 1
            ? [{ update_id: 1, message: { message_id: 10, date: 1, chat: { id: 777, type: "private", first_name: "Other" }, from: { id: 100, is_bot: false, first_name: "Other", username: "other_user" }, text: "hi" } }]
            : [{ update_id: 2, message: { message_id: 11, date: 2, chat: { id: 12345, type: "private", first_name: "Boss" }, from: { id: 12345, is_bot: false, first_name: "Quy", last_name: "Nguyen", username: "boss_user" }, text: "hi" } }];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      }),
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      channels?: { telegram?: { ownerUserId: string } };
    };

    assert.equal(config.channels?.telegram?.ownerUserId, "12345");
    assert.deepEqual(confirmations, ["Đây có phải tài khoản của bạn, Other?", "Đây có phải tài khoản của bạn, Quy Nguyen?"]);
    assert.ok(output.some((line) => line.includes("Chưa xác nhận tài khoản này")));
    assert.ok(output.every((line) => !line.includes("telegram-secret-token")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand setup ignores bot updates before confirming the owner", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let pollCount = 0;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "setup"],
      paths,
      questioner: {
        ask: async () => "",
        askHidden: async () => "telegram-secret-token",
        confirm: async () => true,
        close: () => undefined,
      },
      clientFactory: () => ({
        async getUpdates() {
          pollCount += 1;
          return pollCount === 1
            ? [{ update_id: 1, message: { message_id: 10, date: 1, chat: { id: 99, type: "private", first_name: "Bot" }, from: { id: 99, is_bot: true, first_name: "Bot" }, text: "hello" } }]
            : [{ update_id: 2, message: { message_id: 11, date: 2, chat: { id: 12345, type: "private", first_name: "Boss" }, from: { id: 12345, is_bot: false, first_name: "Boss" }, text: "hi" } }];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      }),
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { channels?: { telegram?: { ownerUserId: string } } };
    assert.equal(config.channels?.telegram?.ownerUserId, "12345");
    assert.ok(output.some((line) => line.includes("Đã nhận tin nhắn từ Boss")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand whoami prints recent Telegram sender id and username before owner is configured", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "" } },
      },
      paths,
    );
    await writeEnvFile({ BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "whoami"],
      paths,
      clientFactory: () => ({
        async getUpdates() {
          return [{ update_id: 1, message: { message_id: 10, date: 1, chat: { id: 777, type: "private", first_name: "Boss" }, from: { id: 12345, is_bot: false, first_name: "Boss", username: "boss_user" }, text: "hi" } }];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      }),
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const text = output.join("\n");
    assert.match(text, /Tra cứu owner Telegram/);
    assert.match(text, /ID\s+12345/);
    assert.match(text, /Username\s+@boss_user/);
    assert.match(text, /channels\.telegram\.ownerUserId/);
    assert.ok(output.every((line) => !line.includes("telegram-secret-token")));
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand whoami explains when no recent Telegram sender exists", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "" } },
      },
      paths,
    );
    await writeEnvFile({ BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "whoami"],
      paths,
      clientFactory: () => ({
        async getUpdates() {
          return [];
        },
        async sendMessage() {},
        async editMessageText() {},
        async sendChatAction() {},
        async setMyCommands() {},
      }),
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const text = output.join("\n");
    assert.match(text, /Chưa tìm thấy tin nhắn gần đây từ owner/);
    assert.match(text, /Gửi một tin nhắn bất kỳ cho bot Telegram/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand rejects removed voice setup alias", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(
      () => runTelegramCommand({ argv: ["node", "bestie", "channels", "telegram", "voice", "setup-local"], paths, writeLine: () => undefined }),
      /bestie channels telegram \[setup\|whoami\|--once\]/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-local writes wrapper and local transcription config", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const oldPath = process.env.PATH;

  try {
    await mkdir(resolve(paths.rootDir, ".bestie/tools/whisper-bin"), { recursive: true });
    await mkdir(resolve(paths.rootDir, ".bestie/models"), { recursive: true });
    await mkdir(resolve(paths.rootDir, "bin"), { recursive: true });
    await writeFile(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), 0o755);
    await writeFile(resolve(paths.rootDir, ".bestie/models/ggml-small.bin"), new Uint8Array([1, 2, 3]));
    await writeFile(resolve(paths.rootDir, "bin/ffmpeg"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, "bin/ffmpeg"), 0o755);
    process.env.PATH = `${resolve(paths.rootDir, "bin")}${delimiter}${oldPath ?? ""}`;
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { allowedMimeTypes: ["text/*"] } } },
      },
      paths,
    );

    await runVoiceCommand({ argv: ["node", "bestie", "voice", "setup-local"], paths, writeLine: (message) => output.push(message), useColor: false });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      transcription?: { provider: string; command: string; args: string[]; modelPath: string; timeoutMs: number };
      channels?: { telegram?: { attachments?: { transcriptionPolicy?: string; deleteAfterProcessingKinds?: string[]; allowedMimeTypes?: string[] } } };
    };
    const wrapperPath = resolve(paths.rootDir, ".bestie/tools/local-whisper-transcribe.sh");
    const wrapper = await readFile(wrapperPath, "utf8");

    await access(wrapperPath, constants.X_OK);
    assert.match(wrapper, /ffmpeg/);
    assert.deepEqual(config.transcription, {
      provider: "local-whisper",
      command: ".bestie/tools/local-whisper-transcribe.sh",
      args: ["{modelPath}", "{audioPath}", "-l", "vi"],
      modelPath: ".bestie/models/ggml-small.bin",
      timeoutMs: 120_000,
    });
    assert.equal(config.channels?.telegram?.attachments?.transcriptionPolicy, "allow");
    assert.deepEqual(config.channels?.telegram?.attachments?.deleteAfterProcessingKinds, ["voice", "audio"]);
    assert.deepEqual(config.channels?.telegram?.attachments?.allowedMimeTypes, ["text/*"]);
    assert.ok(output.some((line) => line.includes("Giọng nói local Bestie")));
    assert.ok(output.some((line) => line.includes("Đã lưu cấu hình giọng nói local")));
    assert.ok(output.some((line) => line.includes("Ngôn ngữ") && line.includes("vi")));
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
  } finally {
    process.env.PATH = oldPath;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-local uses agent language for local transcription", async () => {
  const paths = await createTempPaths();
  const oldPath = process.env.PATH;

  try {
    await mkdir(resolve(paths.rootDir, ".bestie/tools/whisper-bin"), { recursive: true });
    await mkdir(resolve(paths.rootDir, ".bestie/models"), { recursive: true });
    await mkdir(resolve(paths.rootDir, "bin"), { recursive: true });
    await writeFile(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), 0o755);
    await writeFile(resolve(paths.rootDir, ".bestie/models/ggml-small.bin"), new Uint8Array([1, 2, 3]));
    await writeFile(resolve(paths.rootDir, "bin/ffmpeg"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, "bin/ffmpeg"), 0o755);
    process.env.PATH = `${resolve(paths.rootDir, "bin")}${delimiter}${oldPath ?? ""}`;
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "mixed", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runVoiceCommand({ argv: ["node", "bestie", "voice", "setup-local"], paths, writeLine: () => undefined });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { transcription?: { args: string[] } };
    assert.deepEqual(config.transcription?.args, ["{modelPath}", "{audioPath}", "-l", "auto"]);
  } finally {
    process.env.PATH = oldPath;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-elevenlabs writes speech config and API key env", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let closed = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);

    await runVoiceCommand({
      argv: ["node", "bestie", "voice", "setup-elevenlabs"],
      paths,
      questioner: {
        ask: async () => "",
        askHidden: async () => "elevenlabs-secret-token",
        close: () => {
          closed = true;
        },
      },
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      transcription?: { provider: string; apiKeyEnv: string; modelId: string; tagAudioEvents: boolean; diarize: boolean; timeoutMs: number };
      speech?: { provider: string; apiKeyEnv: string; voiceId: string; modelId: string; outputFormat: string; timeoutMs: number };
      channels?: { telegram?: { voiceReplyPolicy?: string; voiceReplyMaxChars?: number; voiceReplyCooldownMs?: number; attachments?: { transcriptionPolicy?: string; deleteAfterProcessingKinds?: string[]; allowedMimeTypes?: string[] } } };
    };
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(closed, true);
    assert.deepEqual(config.transcription, {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      modelId: "scribe_v2",
      tagAudioEvents: true,
      diarize: false,
      timeoutMs: 120_000,
    });
    assert.deepEqual(config.speech, {
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      voiceId: "NOpBlnGInO9m6vDvFkFC",
      modelId: "eleven_v3",
      outputFormat: "mp3_44100_128",
      timeoutMs: 60_000,
    });
    assert.equal(config.channels?.telegram?.voiceReplyPolicy, "voice-input-only");
    assert.equal(config.channels?.telegram?.voiceReplyMaxChars, 800);
    assert.equal(config.channels?.telegram?.voiceReplyCooldownMs, 30_000);
    assert.equal(config.channels?.telegram?.attachments?.transcriptionPolicy, "allow");
    assert.deepEqual(config.channels?.telegram?.attachments?.deleteAfterProcessingKinds, ["voice", "audio"]);
    assert.equal(config.channels?.telegram?.attachments?.allowedMimeTypes, undefined);
    assert.match(envText, /OPENAI_API_KEY="sk-test"/);
    assert.match(envText, /ELEVENLABS_API_KEY="elevenlabs-secret-token"/);
    assert.ok(output.some((line) => line.includes("Giọng nói ElevenLabs cho Bestie")));
    assert.ok(output.some((line) => line.includes("Đã lưu cấu hình giọng nói ElevenLabs")));
    assert.ok(output.every((line) => !line.includes("elevenlabs-secret-token")));
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-voicebox writes local speech and transcription config", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const answers = ["http://127.0.0.1:17493/", "bestie", "Morgan", "qwen", "en", "turbo", "en", "yes"];
  let closed = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      },
      paths,
    );

    await runVoiceCommand({
      argv: ["node", "bestie", "voice", "setup-voicebox"],
      paths,
      questioner: {
        ask: async () => answers.shift() ?? "",
        askHidden: async () => "",
        close: () => {
          closed = true;
        },
      },
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      transcription?: { provider: string; baseUrl: string; model: string; language: string; clientId: string; timeoutMs: number };
      speech?: { provider: string; baseUrl: string; profile: string; engine: string; language: string; clientId: string; personality: boolean; timeoutMs: number; pollIntervalMs: number };
      channels?: { telegram?: { voiceReplyPolicy?: string; voiceReplyMaxChars?: number; voiceReplyCooldownMs?: number; attachments?: { downloadPolicy?: string; transcriptionPolicy?: string; transcriptionMaxBytes?: number; deleteAfterProcessingKinds?: string[] } } };
    };

    assert.equal(closed, true);
    assert.equal(answers.length, 0);
    assert.deepEqual(config.transcription, {
      provider: "voicebox",
      baseUrl: "http://127.0.0.1:17493",
      model: "turbo",
      language: "en",
      clientId: "bestie",
      timeoutMs: 120_000,
    });
    assert.deepEqual(config.speech, {
      provider: "voicebox",
      baseUrl: "http://127.0.0.1:17493",
      profile: "Morgan",
      engine: "qwen",
      language: "en",
      clientId: "bestie",
      personality: true,
      timeoutMs: 180_000,
      pollIntervalMs: 1_000,
    });
    assert.equal(config.channels?.telegram?.voiceReplyPolicy, "voice-input-only");
    assert.equal(config.channels?.telegram?.voiceReplyMaxChars, 800);
    assert.equal(config.channels?.telegram?.voiceReplyCooldownMs, 30_000);
    assert.equal(config.channels?.telegram?.attachments?.downloadPolicy, "allow");
    assert.equal(config.channels?.telegram?.attachments?.transcriptionPolicy, "allow");
    assert.equal(config.channels?.telegram?.attachments?.transcriptionMaxBytes, 10_485_760);
    assert.deepEqual(config.channels?.telegram?.attachments?.deleteAfterProcessingKinds, ["voice", "audio"]);
    assert.ok(output.some((line) => line.includes("Voicebox cho Bestie")));
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-elevenlabs omits language code for mixed language default", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "mixed", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runVoiceCommand({
      argv: ["node", "bestie", "voice", "setup-elevenlabs"],
      paths,
      questioner: {
        ask: async () => "",
        askHidden: async () => "elevenlabs-secret-token",
        close: () => undefined,
      },
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { agent?: { language?: string }; speech?: Record<string, unknown>; transcription?: Record<string, unknown> };
    assert.equal(config.agent?.language, "mixed");
    assert.equal("languageCode" in (config.speech ?? {}), false);
    assert.equal("languageCode" in (config.transcription ?? {}), false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand setup-local fails before writing config when model is missing", async () => {
  const paths = await createTempPaths();
  const oldPath = process.env.PATH;

  try {
    await mkdir(resolve(paths.rootDir, ".bestie/tools/whisper-bin"), { recursive: true });
    await mkdir(resolve(paths.rootDir, "bin"), { recursive: true });
    await writeFile(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, ".bestie/tools/whisper-bin/whisper-cli"), 0o755);
    await writeFile(resolve(paths.rootDir, "bin/ffmpeg"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, "bin/ffmpeg"), 0o755);
    process.env.PATH = `${resolve(paths.rootDir, "bin")}${delimiter}${oldPath ?? ""}`;
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await assert.rejects(
      () => runVoiceCommand({ argv: ["node", "bestie", "voice", "setup-local"], paths, writeLine: () => undefined }),
      /Thiếu model whisper local hoặc không đọc được/,
    );
  } finally {
    process.env.PATH = oldPath;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand models lists local models and marks configured model", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(resolve(paths.rootDir, ".bestie/models"), { recursive: true });
    await writeFile(resolve(paths.rootDir, ".bestie/models/ggml-small.bin"), new Uint8Array(2048));
    await writeFile(resolve(paths.rootDir, ".bestie/models/ggml-tiny.bin"), new Uint8Array(1024));
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        transcription: { provider: "local-whisper", command: ".bestie/tools/local-whisper-transcribe.sh", args: ["{modelPath}", "{audioPath}", "-l", "vi"], modelPath: ".bestie/models/ggml-small.bin" },
      },
      paths,
    );

    await runVoiceCommand({ argv: ["node", "bestie", "voice", "models"], paths, writeLine: (message) => output.push(message), useColor: false });

    const text = output.join("\n");
  assert.match(text, /Model giọng nói Bestie/);
  assert.match(text, /\*\s+ggml-small\.bin\s+2\.0 KiB\s+mốc khuyến nghị cho tiếng Việt/);
    assert.match(text, /ggml-tiny\.bin\s+1\.0 KiB\s+nhanh, chất lượng thấp với tiếng Việt/);
    assert.match(text, /Đã cấu hình/);
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand models reports when no local models exist", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runVoiceCommand({ argv: ["node", "bestie", "voice", "models"], paths, writeLine: (message) => output.push(message) });

    assert.match(output.join("\n"), /Chưa tìm thấy model whisper\.cpp \.bin cục bộ/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand download-model previews without downloading by default", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let fetchCalled = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runVoiceCommand({
      argv: ["node", "bestie", "voice", "download-model", "small"],
      paths,
      modelDownloadFetchImpl: async () => {
        fetchCalled = true;
        return new Response("model bytes");
      },
      writeLine: (message) => output.push(message),
      useColor: false,
    });

    assert.equal(fetchCalled, false);
    assert.match(output.join("\n"), /Model giọng nói Bestie/);
    assert.match(output.join("\n"), /Chỉ chạy thử/);
    assert.ok(output.every((line) => !/\x1b\[[0-9;]*m/.test(line)));
    await assert.rejects(() => access(resolve(paths.rootDir, ".bestie/models/ggml-small.bin")), /ENOENT/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand download-model downloads and can update config", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "en", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await runVoiceCommand({
      argv: ["node", "bestie", "voice", "download-model", "tiny", "--confirm", "--use"],
      paths,
      modelDownloadFetchImpl: async () => new Response("model bytes", { headers: { "content-length": "11" } }),
      writeLine: (message) => output.push(message),
    });

    const modelBytes = await readFile(resolve(paths.rootDir, ".bestie/models/ggml-tiny.bin"), "utf8");
    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { transcription?: { modelPath: string; args: string[] } };

    assert.equal(modelBytes, "model bytes");
    assert.equal(config.transcription?.modelPath, ".bestie/models/ggml-tiny.bin");
    assert.deepEqual(config.transcription?.args, ["{modelPath}", "{audioPath}", "-l", "en"]);
    assert.match(output.join("\n"), /Đã tải: \.bestie\/models\/ggml-tiny\.bin/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runVoiceCommand download-model refuses to overwrite without force", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(resolve(paths.rootDir, ".bestie/models"), { recursive: true });
    await writeFile(resolve(paths.rootDir, ".bestie/models/ggml-tiny.bin"), "existing");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );

    await assert.rejects(
      () =>
        runVoiceCommand({
          argv: ["node", "bestie", "voice", "download-model", "tiny", "--confirm"],
          paths,
          modelDownloadFetchImpl: async () => new Response("model bytes"),
          writeLine: () => undefined,
        }),
      /Dùng --force để ghi đè/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand writes a redacted Telegram smoke transcript", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "--once", "--transcript", ".bestie/logs/telegram-smoke.jsonl"],
      paths,
      clientFactory: () => ({
        getUpdates: async () => [
          {
            update_id: 1,
            message: {
              message_id: 10,
              date: 1,
              chat: { id: 777, type: "private", first_name: "Boss" },
              from: { id: 12345, is_bot: false, first_name: "Boss" },
              text: "/start",
            },
          },
        ],
        sendMessage: async () => undefined,
        editMessageText: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
      }),
      writeLine: (message) => output.push(message),
    });

    const transcriptText = await readFile(resolve(paths.rootDir, ".bestie/logs/telegram-smoke.jsonl"), "utf8");
    const events = transcriptText.trim().split("\n").map((line) => JSON.parse(line) as { event: string; detail: Record<string, unknown> });

    assert.deepEqual(events.map((event) => event.event), [
      "telegram_set_my_commands",
      "telegram_get_updates_start",
      "telegram_get_updates_finish",
      "telegram_send_chat_action",
      "telegram_send_message",
    ]);
    assert.equal((events[2].detail.updates as Array<{ fromOwner: boolean; textLength: number }>)[0].fromOwner, true);
    assert.equal((events[2].detail.updates as Array<{ fromOwner: boolean; textLength: number }>)[0].textLength, 6);
    assert.equal(events[4].detail.kind, "reply");
    assert.doesNotMatch(transcriptText, /telegram-secret-token|\/start|Miu is online/);
    assert.ok(output.some((line) => line.includes("Transcript smoke Telegram")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand writes redacted Telegram attachment transcript events", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "--once", "--transcript", ".bestie/logs/telegram-attachment-smoke.jsonl"],
      paths,
      clientFactory: () => ({
        getUpdates: async () => [
          {
            update_id: 1,
            message: {
              message_id: 10,
              date: 1,
              chat: { id: 777, type: "private", first_name: "Boss" },
              from: { id: 12345, is_bot: false, first_name: "Boss" },
              caption: "please read",
              document: { file_id: "doc-secret-id", file_unique_id: "doc-unique", file_name: "secret-note.txt", mime_type: "text/plain", file_size: 12 },
            },
          },
        ],
        getFile: async () => ({ fileId: "doc-secret-id", filePath: "documents/secret-note.txt", fileSize: 12 }),
        downloadFile: async () => new TextEncoder().encode("hello smoke\n"),
        sendMessage: async () => undefined,
        editMessageText: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
      }),
      chatCompletion: async (_config, _apiKey, options) => {
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Attachment smoke reply."}';
      },
      writeLine: () => undefined,
    });

    const transcriptText = await readFile(resolve(paths.rootDir, ".bestie/logs/telegram-attachment-smoke.jsonl"), "utf8");
    const events = transcriptText.trim().split("\n").map((line) => JSON.parse(line) as { event: string; detail: Record<string, unknown> });

    assert.deepEqual(events.map((event) => event.event), [
      "telegram_set_my_commands",
      "telegram_get_updates_start",
      "telegram_get_updates_finish",
      "telegram_send_chat_action",
      "telegram_get_file_start",
      "telegram_get_file_finish",
      "telegram_download_file_start",
      "telegram_download_file_finish",
      "telegram_attachment_parse",
      "telegram_send_message",
    ]);
    const updateSummary = (events[2].detail.updates as Array<{ fromOwner: boolean; hasAttachment: boolean; attachmentKind: string; captionLength: number }>)[0];
    assert.deepEqual({ fromOwner: updateSummary.fromOwner, hasAttachment: updateSummary.hasAttachment, attachmentKind: updateSummary.attachmentKind, captionLength: updateSummary.captionLength }, { fromOwner: true, hasAttachment: true, attachmentKind: "document", captionLength: 11 });
    assert.equal(events[5].detail.hasFilePath, true);
    assert.equal(events[7].detail.bytes, 12);
    assert.deepEqual(events[8].detail, {
      kind: "document",
      mimeType: "text/plain",
      telegramFileSize: 12,
      savedBytes: 12,
      contentParser: "text",
      hasTextPreview: true,
      textPreviewTruncated: false,
      hasParseWarning: false,
      hasVisionInput: false,
      hasAudioTranscript: false,
      audioTranscriptTruncated: false,
      hasTranscriptionWarning: false,
    });
    assert.doesNotMatch(transcriptText, /telegram-secret-token|doc-secret-id|secret-note|hello smoke|please read/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand wires configured audio transcription for Telegram voice attachments", async () => {
  const paths = await createTempPaths();
  let transcriptionRequest: { url: string; body: FormData } | undefined;
  let agentSawTranscript = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token", BESTIE_TRANSCRIPTION_API_KEY: "transcription-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "--once", "--transcript", ".bestie/logs/telegram-voice-smoke.jsonl"],
      paths,
      clientFactory: () => ({
        getUpdates: async () => [
          {
            update_id: 1,
            message: {
              message_id: 10,
              date: 1,
              chat: { id: 777, type: "private", first_name: "Boss" },
              from: { id: 12345, is_bot: false, first_name: "Boss" },
              caption: "please transcribe",
              voice: { file_id: "voice-secret-id", file_unique_id: "voice-unique", duration: 2, mime_type: "audio/ogg", file_size: 3 },
            },
          },
        ],
        getFile: async () => ({ fileId: "voice-secret-id", filePath: "voice/secret-voice.ogg", fileSize: 3 }),
        downloadFile: async () => new Uint8Array([1, 2, 3]),
        sendMessage: async () => undefined,
        editMessageText: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
      }),
      transcriptionFetchImpl: async (url, init) => {
        transcriptionRequest = { url: String(url), body: init?.body as FormData };
        return new Response(JSON.stringify({ text: "xin chào từ provider" }), { status: 200 });
      },
      chatCompletion: async (_config, _apiKey, options) => {
        agentSawTranscript ||= JSON.stringify(options.messages).includes("xin chào từ provider");
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Voice transcript reply."}';
      },
      writeLine: () => undefined,
    });

    assert.equal(transcriptionRequest?.url, "https://audio.example.com/v1/audio/transcriptions");
    assert.equal(transcriptionRequest?.body.get("model"), "whisper-1");
    assert.ok(agentSawTranscript);

    const transcriptText = await readFile(resolve(paths.rootDir, ".bestie/logs/telegram-voice-smoke.jsonl"), "utf8");
    assert.match(transcriptText, /"hasAudioTranscript":true/);
    assert.doesNotMatch(transcriptText, /xin chào từ provider|voice-secret-id|secret-voice|transcription-secret-token|please transcribe|"chat":"777"|"from":"12345"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand sends Telegram voice reply for voice input when configured", async () => {
  const paths = await createTempPaths();
  let speechRequest: { url: string; body: { model: string; input: string } } | undefined;
  const sentVoice: Array<{ bytes: number; mimeType?: string }> = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        transcription: { provider: "openai-compatible", baseUrl: "https://audio.example.com/v1", model: "whisper-1", apiKeyEnv: "BESTIE_TRANSCRIPTION_API_KEY" },
        speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", voiceReplyPolicy: "voice-input-only", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token", BESTIE_TRANSCRIPTION_API_KEY: "transcription-secret-token", BESTIE_TTS_API_KEY: "tts-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "--once"],
      paths,
      clientFactory: () => ({
        getUpdates: async () => [
          {
            update_id: 1,
            message: {
              message_id: 10,
              date: 1,
              chat: { id: 777, type: "private", first_name: "Boss" },
              from: { id: 12345, is_bot: false, first_name: "Boss" },
              voice: { file_id: "voice-secret-id", file_unique_id: "voice-unique", duration: 2, mime_type: "audio/ogg", file_size: 3 },
            },
          },
        ],
        getFile: async () => ({ fileId: "voice-secret-id", filePath: "voice/secret-voice.ogg", fileSize: 3 }),
        downloadFile: async () => new Uint8Array([1, 2, 3]),
        sendMessage: async () => undefined,
        sendVoice: async (_chatId, voice, options) => {
          sentVoice.push({ bytes: voice.byteLength, mimeType: options?.mimeType });
        },
        editMessageText: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
      }),
      transcriptionFetchImpl: async () => new Response(JSON.stringify({ text: "xin chào từ provider" }), { status: 200 }),
      speechFetchImpl: async (url, init) => {
        speechRequest = { url: String(url), body: JSON.parse(String(init?.body)) };
        return new Response(new Uint8Array([4, 5, 6, 7]), { status: 200, headers: { "content-type": "audio/mp3" } });
      },
      speechVoiceConverter: async (speech) => ({ bytes: new Uint8Array([...speech.bytes, 8]), mimeType: "audio/ogg" }),
      chatCompletion: async (_config, _apiKey, options) => {
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Chị nghe rõ rồi nha."}';
      },
      writeLine: () => undefined,
    });

    assert.equal(speechRequest?.url, "http://localhost:20128/v1/audio/speech");
    assert.deepEqual(speechRequest?.body, { model: "google-tts/vi", input: "Chị nghe rõ rồi nha." });
    assert.deepEqual(sentVoice, [{ bytes: 5, mimeType: "audio/ogg" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTelegramCommand wires local audio transcription for Telegram voice attachments", async () => {
  const paths = await createTempPaths();
  let agentSawTranscript = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    const scriptPath = resolve(paths.rootDir, "fake-local-whisper.mjs");
    const modelPath = resolve(paths.rootDir, "ggml-small.bin");
    await writeFile(modelPath, new Uint8Array([1]));
    await writeFile(scriptPath, "if (!process.argv.includes('-f')) process.exit(8); process.stdout.write('xin chao tu local whisper\\n');\n");
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
        transcription: { provider: "local-whisper", command: process.execPath, args: [scriptPath, "-m", "{modelPath}", "-f", "{audioPath}"], modelPath },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);

    await runTelegramCommand({
      argv: ["node", "bestie", "channels", "telegram", "--once", "--transcript", ".bestie/logs/telegram-local-voice-smoke.jsonl"],
      paths,
      clientFactory: () => ({
        getUpdates: async () => [
          {
            update_id: 1,
            message: {
              message_id: 10,
              date: 1,
              chat: { id: 777, type: "private", first_name: "Boss" },
              from: { id: 12345, is_bot: false, first_name: "Boss" },
              caption: "please transcribe locally",
              voice: { file_id: "voice-secret-id", file_unique_id: "voice-unique", duration: 2, mime_type: "audio/ogg", file_size: 3 },
            },
          },
        ],
        getFile: async () => ({ fileId: "voice-secret-id", filePath: "voice/secret-voice.ogg", fileSize: 3 }),
        downloadFile: async () => new Uint8Array([1, 2, 3]),
        sendMessage: async () => undefined,
        editMessageText: async () => undefined,
        sendChatAction: async () => undefined,
        setMyCommands: async () => undefined,
      }),
      chatCompletion: async (_config, _apiKey, options) => {
        agentSawTranscript ||= JSON.stringify(options.messages).includes("xin chao tu local whisper");
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Local voice transcript reply."}';
      },
      writeLine: () => undefined,
    });

    assert.ok(agentSawTranscript);
    const transcriptText = await readFile(resolve(paths.rootDir, ".bestie/logs/telegram-local-voice-smoke.jsonl"), "utf8");
    assert.match(transcriptText, /"hasAudioTranscript":true/);
    assert.doesNotMatch(transcriptText, /xin chao tu local whisper|voice-secret-id|secret-voice|please transcribe locally|"chat":"777"|"from":"12345"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("isTelegramToolProgressText recognizes friendly activity messages", () => {
  assert.equal(isTelegramToolProgressText("Miu is listing files in src/cli"), true);
  assert.equal(isTelegramToolProgressText("Bestie is reading file README.md"), true);
  assert.equal(isTelegramToolProgressText("Miu is searching files for *.md in docs"), true);
  assert.equal(isTelegramToolProgressText("Miu replies normally"), false);
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-telegram-command-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

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
    workspaceDir: resolve(appDir, "workspace"),
  };
}




