import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "./config.js";
import { writeEnvFile } from "./env.js";
import { appendLog } from "./logger.js";
import { runDoctor } from "./doctor.js";
import { validateDoctorReportContract } from "./doctor-report-contract.js";
import type { RuntimePaths } from "./paths.js";

test("runDoctor reports missing local setup", async () => {
  const paths = await createTempPaths();

  try {
    const report = await runDoctor(paths);

    assert.ok(report.issueCount >= 3);
    assert.equal(report.checks.find((check) => check.name === "Config file")?.status, "fail");
    assert.equal(report.checks.find((check) => check.name === ".env file")?.status, "fail");
    assert.equal(report.checks.find((check) => check.name === "Character prompt")?.status, "fail");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor omits undefined check fixes from its report contract", async () => {
  const paths = await createConfiguredPaths();

  try {
    const report = await runDoctor(paths);
    const passCheck = report.checks.find((check) => check.status === "pass");

    assert.ok(passCheck);
    assert.equal(Object.hasOwn(passCheck, "fix"), false);
    assert.deepEqual(validateDoctorReportContract(report), { valid: true, errors: [] });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor --fix creates local runtime directories and memory database", async () => {
  const paths = await createTempPaths();

  try {
    const report = await runDoctor(paths, { fix: true });

    assert.equal(report.fixes.find((fix) => fix.name === "App directory")?.status, "fixed");
    assert.equal(report.fixes.find((fix) => fix.name === "Log directory")?.status, "fixed");
    assert.equal(report.fixes.find((fix) => fix.name === "Data directory")?.status, "fixed");
    assert.equal(report.fixes.find((fix) => fix.name === "Memory database")?.status, "fixed");
    assert.ok((await stat(paths.appDir)).isDirectory());
    assert.ok((await stat(paths.logsDir)).isDirectory());
    assert.ok((await stat(paths.dataDir)).isDirectory());
    assert.ok((await stat(paths.memoryDbPath)).isFile());
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor --fix repairs broad local file permissions without exposing secrets", async () => {
  const paths = await createConfiguredPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.envPath, 'OPENAI_API_KEY="sk-test-secret"\n', { mode: 0o644 });
    await writeFile(paths.appLogPath, '{"event":"test"}\n', { mode: 0o644 });
    await chmod(paths.envPath, 0o644);
    await chmod(paths.appLogPath, 0o644);

    const report = await runDoctor(paths, { fix: true });

    assert.equal(report.fixes.find((fix) => fix.name === ".env permissions")?.status, "fixed");
    assert.equal(report.fixes.find((fix) => fix.name === "Log file permissions")?.status, "fixed");
    assert.equal((await stat(paths.envPath)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.appLogPath)).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(report), /sk-test-secret/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns when only legacy runtime directory exists", async () => {
  const paths = await createTempPaths();
  const legacyAppDir = resolve(paths.rootDir, ".ai-bestie");

  try {
    await mkdir(legacyAppDir, { recursive: true });

    const report = await runDoctor(paths);
    const legacyCheck = report.checks.find((check) => check.name === "Legacy runtime directory");

    assert.equal(legacyCheck?.status, "warn");
    assert.match(legacyCheck?.message ?? "", /\.ai-bestie/);
    assert.match(legacyCheck?.fix ?? "", /bestie doctor --fix/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor --fix migrates legacy runtime directory and env names", async () => {
  const paths = await createTempPaths();
  const legacyAppDir = resolve(paths.rootDir, ".ai-bestie");

  try {
    await mkdir(legacyAppDir, { recursive: true });
    await writeFile(
      resolve(legacyAppDir, "config.json"),
      `${JSON.stringify({
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "AI_OPENAI_API_KEY", timeoutMs: 60_000 },
        channels: { telegram: { enabled: true, botTokenEnv: "AI_BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      })}\n`,
    );
    await writeFile(resolve(legacyAppDir, ".env"), 'AI_OPENAI_API_KEY="sk-test"\nAI_BESTIE_TELEGRAM_BOT_TOKEN="telegram-token"\n', { mode: 0o600 });
    await writeFile(resolve(legacyAppDir, "system-prompt.md"), "You are Miu.\n");

    const report = await runDoctor(paths, { fix: true });
    const migrationFix = report.fixes.find((fix) => fix.name === "Legacy runtime migration");
    const configText = await readFile(paths.configPath, "utf8");
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(migrationFix?.status, "fixed");
    assert.match(configText, /OPENAI_API_KEY/);
    assert.match(configText, /BESTIE_TELEGRAM_BOT_TOKEN/);
    assert.doesNotMatch(configText, /AI_BESTIE/);
    assert.match(envText, /OPENAI_API_KEY/);
    assert.match(envText, /BESTIE_TELEGRAM_BOT_TOKEN/);
    assert.doesNotMatch(envText, /AI_BESTIE/);
    assert.equal(report.checks.find((check) => check.name === "LLM API key")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Telegram channel")?.status, "pass");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor passes configured Phase Now setup", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);

    assert.equal(report.issueCount, 0);
    assert.equal(report.checks.find((check) => check.name === "Runtime paths")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "LLM API key")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "LLM timeout")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === ".env permissions")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Log directory")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Log file permissions"), undefined);
    const memoryCheck = report.checks.find((check) => check.name === "Memory database");
    assert.equal(memoryCheck?.status, "pass");
    assert.match(memoryCheck?.message ?? "", /schema is ready/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns when llm.timeoutMs is missing from older configs", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
      },
      paths,
    );

    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const timeoutCheck = report.checks.find((check) => check.name === "LLM timeout");

    assert.equal(report.issueCount, 0);
    assert.equal(timeoutCheck?.status, "warn");
    assert.match(timeoutCheck?.message ?? "", /not configured/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns about recent provider fallback failures", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");
    await appendLog(
      {
        event: "chat_request_failure",
        detail: {
          message: "All configured LLM providers failed.",
          fallbackAttempts: [
            { provider: "openai-compatible", model: "primary-model", error: "502" },
            { provider: "openai-compatible", model: "fallback-model", error: "timeout" },
          ],
        },
      },
      { paths },
    );

    const report = await runDoctor(paths);
    const providerHealthCheck = report.checks.find((check) => check.name === "Provider fallback health");

    assert.equal(report.issueCount, 0);
    assert.equal(providerHealthCheck?.status, "warn");
    assert.match(providerHealthCheck?.message ?? "", /provider fallback failures recent 2/);
    assert.match(providerHealthCheck?.message ?? "", /openai-compatible\/primary-model x1/);
    assert.match(providerHealthCheck?.fix ?? "", /fallback provider chain/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns about unusual LLM request timeouts", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 1000 },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const timeoutCheck = report.checks.find((check) => check.name === "LLM timeout");

    assert.equal(report.issueCount, 0);
    assert.equal(timeoutCheck?.status, "warn");
    assert.match(timeoutCheck?.message ?? "", /very low/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails when sensitive runtime paths leave app dir", async () => {
  const paths = await createTempPaths();

  try {
    const report = await runDoctor({ ...paths, envPath: resolve(paths.rootDir, "outside.env") });
    const runtimePathsCheck = report.checks.find((check) => check.name === "Runtime paths");

    assert.equal(runtimePathsCheck?.status, "fail");
    assert.match(runtimePathsCheck?.message ?? "", /outside.env/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails broad .env permissions without exposing secrets", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test-secret" }, paths);
    await chmod(paths.envPath, 0o644);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const permissionsCheck = report.checks.find((check) => check.name === ".env permissions");

    assert.equal(permissionsCheck?.status, "fail");
    assert.match(permissionsCheck?.message ?? "", /too broad/);
    assert.doesNotMatch(JSON.stringify(report), /sk-test-secret/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails broad log file permissions", async () => {
  const paths = await createConfiguredPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "{\"event\":\"test\"}\n", { mode: 0o644 });
    await chmod(paths.appLogPath, 0o644);

    const report = await runDoctor(paths);
    const permissionsCheck = report.checks.find((check) => check.name === "Log file permissions");

    assert.equal(permissionsCheck?.status, "fail");
    assert.match(permissionsCheck?.message ?? "", /too broad/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor skips POSIX chmod permission checks on Windows", async () => {
  const paths = await createConfiguredPaths();

  try {
    await chmod(paths.envPath, 0o666);
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "{\"event\":\"test\"}\n", { mode: 0o666 });
    await chmod(paths.appLogPath, 0o666);

    const report = await runDoctor(paths, { platform: "win32" });
    const envPermissionsCheck = report.checks.find((check) => check.name === ".env permissions");
    const logPermissionsCheck = report.checks.find((check) => check.name === "Log file permissions");

    assert.equal(report.issueCount, 0);
    assert.equal(envPermissionsCheck?.status, "pass");
    assert.match(envPermissionsCheck?.message ?? "", /Windows ACLs/);
    assert.equal(logPermissionsCheck?.status, "pass");
    assert.match(logPermissionsCheck?.message ?? "", /Windows ACLs/);
    assert.doesNotMatch(JSON.stringify(report), /chmod/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor --fix skips chmod fixes on Windows", async () => {
  const paths = await createConfiguredPaths();

  try {
    await chmod(paths.envPath, 0o666);
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "{\"event\":\"test\"}\n", { mode: 0o666 });

    const report = await runDoctor(paths, { fix: true, platform: "win32" });

    assert.equal(report.fixes.find((fix) => fix.name === ".env permissions")?.status, "skipped");
    assert.match(report.fixes.find((fix) => fix.name === ".env permissions")?.message ?? "", /Windows ACLs/);
    assert.equal(report.fixes.find((fix) => fix.name === "Log file permissions")?.status, "skipped");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor ignores Telegram checks when Telegram is not configured", async () => {
  const paths = await createConfiguredPaths();

  try {
    const report = await runDoctor(paths);

    assert.equal(report.checks.find((check) => check.name === "Telegram channel"), undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor checks Telegram token only when Telegram is enabled", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const telegramCheck = report.checks.find((check) => check.name === "Telegram channel");

    assert.equal(telegramCheck?.status, "fail");
    assert.match(telegramCheck?.message ?? "", /BESTIE_TELEGRAM_BOT_TOKEN/);
    assert.doesNotMatch(JSON.stringify(report), /sk-test/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor skips Telegram identity network check unless requested", async () => {
  const paths = await createTempPaths();
  let called = false;

  try {
    await writeTelegramConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" });

    const report = await runDoctor(paths, {
      telegramIdentityChecker: async () => {
        called = true;
        return { id: 42, username: "miu_bot" };
      },
    });

    assert.equal(called, false);
    assert.equal(report.checks.find((check) => check.name === "Telegram channel")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Telegram bot identity"), undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor checks Zalo token only when Zalo is enabled", async () => {
  const paths = await createTempPaths();

  try {
    await writeZaloConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test" });

    const report = await runDoctor(paths);
    const zaloCheck = report.checks.find((check) => check.name === "Zalo channel");

    assert.equal(zaloCheck?.status, "fail");
    assert.match(zaloCheck?.message ?? "", /BESTIE_ZALO_BOT_TOKEN/);
    assert.doesNotMatch(JSON.stringify(report), /sk-test/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor skips Zalo identity network check unless requested", async () => {
  const paths = await createTempPaths();
  let called = false;

  try {
    await writeZaloConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_ZALO_BOT_TOKEN: "zalo-secret-token" });

    const report = await runDoctor(paths, {
      zaloIdentityChecker: async () => {
        called = true;
        return { id: "bot-1", username: "miu_zalo" };
      },
    });

    assert.equal(called, false);
    assert.equal(report.checks.find((check) => check.name === "Zalo channel")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Zalo bot identity"), undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor verifies Zalo bot identity when requested", async () => {
  const paths = await createTempPaths();

  try {
    await writeZaloConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_ZALO_BOT_TOKEN: "zalo-secret-token" });

    const report = await runDoctor(paths, {
      connectZalo: true,
      zaloIdentityChecker: async (token) => {
        assert.equal(token, "zalo-secret-token");
        return { id: "bot-1", username: "miu_zalo" };
      },
    });
    const identityCheck = report.checks.find((check) => check.name === "Zalo bot identity");

    assert.equal(identityCheck?.status, "pass");
    assert.match(identityCheck?.message ?? "", /@miu_zalo/);
    assert.doesNotMatch(JSON.stringify(report), /zalo-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor reports Zalo bot identity failures without exposing token", async () => {
  const paths = await createTempPaths();

  try {
    await writeZaloConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_ZALO_BOT_TOKEN: "zalo-secret-token" });

    const report = await runDoctor(paths, {
      connectZalo: true,
      zaloIdentityChecker: async () => {
        throw new Error("Unauthorized");
      },
    });
    const identityCheck = report.checks.find((check) => check.name === "Zalo bot identity");

    assert.equal(identityCheck?.status, "fail");
    assert.match(identityCheck?.message ?? "", /Unauthorized/);
    assert.doesNotMatch(JSON.stringify(report), /zalo-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns when retained Telegram attachments exceed the storage threshold", async () => {
  const paths = await createTempPaths();

  try {
    await writeTelegramConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" });
    await mkdir(resolve(paths.workspaceDir, "telegram/2026-07-11"), { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "telegram/2026-07-11/1-2-voice-message.ogg"), new Uint8Array(2048));

    const report = await runDoctor(paths, { telegramWorkspaceWarnBytes: 1024 });
    const storageCheck = report.checks.find((check) => check.name === "Telegram attachment storage");

    assert.equal(storageCheck?.status, "warn");
    assert.match(storageCheck?.message ?? "", /Telegram attachments are using 2\.0 KiB/);
    assert.match(storageCheck?.fix ?? "", /tools attachments cleanup/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor passes Telegram attachment storage when usage stays below threshold", async () => {
  const paths = await createTempPaths();

  try {
    await writeTelegramConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" });

    const report = await runDoctor(paths, { telegramWorkspaceWarnBytes: 1024 });
    const storageCheck = report.checks.find((check) => check.name === "Telegram attachment storage");

    assert.equal(storageCheck?.status, "pass");
    assert.match(storageCheck?.message ?? "", /No retained Telegram attachment files/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails when Telegram transcription is allowed without a provider", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const transcriptionCheck = report.checks.find((check) => check.name === "Transcription provider");

    assert.equal(transcriptionCheck?.status, "fail");
    assert.match(transcriptionCheck?.message ?? "", /no top-level transcription provider/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor checks ElevenLabs transcription provider", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        transcription: { provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY", modelId: "scribe_v2" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token", ELEVENLABS_API_KEY: "elevenlabs-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const transcriptionCheck = report.checks.find((check) => check.name === "Transcription provider");

    assert.equal(transcriptionCheck?.status, "pass");
    assert.match(transcriptionCheck?.message ?? "", /ElevenLabs transcription API key env ELEVENLABS_API_KEY is present/);
    assert.doesNotMatch(JSON.stringify(report), /elevenlabs-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor checks local transcription command and warns for tiny Vietnamese model", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    const commandPath = resolve(paths.rootDir, "fake-whisper.sh");
    const modelPath = resolve(paths.rootDir, "ggml-tiny.bin");
    await writeFile(commandPath, "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
    await chmod(commandPath, 0o755);
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        transcription: { provider: "local-whisper", command: commandPath, args: ["{modelPath}", "{audioPath}", "-l", "vi"], modelPath },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);

    assert.equal(report.checks.find((check) => check.name === "Local transcription command")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Local transcription model")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Local transcription model quality")?.status, "warn");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails when local transcription model is missing", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    const commandPath = resolve(paths.rootDir, "fake-whisper.sh");
    await writeFile(commandPath, "#!/usr/bin/env bash\necho ok\n", { mode: 0o755 });
    await chmod(commandPath, 0o755);
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        transcription: { provider: "local-whisper", command: commandPath, args: ["{modelPath}", "{audioPath}"], modelPath: resolve(paths.rootDir, "missing-model.bin") },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", attachments: { transcriptionPolicy: "allow" } } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const modelCheck = report.checks.find((check) => check.name === "Local transcription model");

    assert.equal(modelCheck?.status, "fail");
    assert.match(modelCheck?.message ?? "", /missing or unreadable/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor checks Telegram speech reply provider and ffmpeg", async () => {
  const paths = await createTempPaths();
  const oldPath = process.env.PATH;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(resolve(paths.rootDir, "bin"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "bin/ffmpeg"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    await chmod(resolve(paths.rootDir, "bin/ffmpeg"), 0o755);
    process.env.PATH = `${resolve(paths.rootDir, "bin")}${delimiter}${oldPath ?? ""}`;
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", voiceReplyPolicy: "voice-input-only" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token", BESTIE_TTS_API_KEY: "tts-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);

    assert.equal(report.checks.find((check) => check.name === "Telegram speech provider")?.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "Telegram speech ffmpeg")?.status, "pass");
  } finally {
    process.env.PATH = oldPath;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor fails when Telegram voice replies are enabled without a speech provider", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", voiceReplyPolicy: "voice-input-only" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const speechCheck = report.checks.find((check) => check.name === "Telegram speech provider");

    assert.equal(speechCheck?.status, "fail");
    assert.match(speechCheck?.message ?? "", /no top-level speech provider/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor can run an opt-in Telegram speech round trip test", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        speech: { provider: "openai-compatible", baseUrl: "http://localhost:20128/v1", model: "google-tts/vi", apiKeyEnv: "BESTIE_TTS_API_KEY" },
        channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345", voiceReplyPolicy: "voice-input-only" } },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token", BESTIE_TTS_API_KEY: "tts-secret-token" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths, {
      testTelegramSpeech: true,
      telegramSpeechTester: async (config, receivedPaths) => {
        assert.equal(config.speech?.provider, "openai-compatible");
        assert.equal(config.speech.model, "google-tts/vi");
        assert.equal(receivedPaths.rootDir, paths.rootDir);
        return { bytes: 1234, mimeType: "audio/ogg" };
      },
    });
    const speechTest = report.checks.find((check) => check.name === "Telegram speech test");

    assert.equal(speechTest?.status, "pass");
    assert.match(speechTest?.message ?? "", /audio\/ogg/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor verifies Telegram bot identity when requested", async () => {
  const paths = await createTempPaths();

  try {
    await writeTelegramConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" });

    const report = await runDoctor(paths, {
      connectTelegram: true,
      telegramIdentityChecker: async (token) => {
        assert.equal(token, "telegram-secret-token");
        return { id: 42, username: "miu_bot" };
      },
    });
    const identityCheck = report.checks.find((check) => check.name === "Telegram bot identity");

    assert.equal(identityCheck?.status, "pass");
    assert.match(identityCheck?.message ?? "", /@miu_bot/);
    assert.doesNotMatch(JSON.stringify(report), /telegram-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor reports Telegram bot identity failures without exposing token", async () => {
  const paths = await createTempPaths();

  try {
    await writeTelegramConfiguredFiles(paths, { OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-secret-token" });

    const report = await runDoctor(paths, {
      connectTelegram: true,
      telegramIdentityChecker: async () => {
        throw new Error("Unauthorized");
      },
    });
    const identityCheck = report.checks.find((check) => check.name === "Telegram bot identity");

    assert.equal(identityCheck?.status, "fail");
    assert.match(identityCheck?.message ?? "", /Unauthorized/);
    assert.doesNotMatch(JSON.stringify(report), /telegram-secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor reports MCP server config without exposing env values", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        mcp: { servers: [{ name: "dry-run", enabled: false, command: "node", env: { SECRET_TOKEN: "mcp-secret-value" }, tools: [{ name: "read_file", category: "read" }] }] },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const mcpCheck = report.checks.find((check) => check.name === "MCP servers");

    assert.equal(report.issueCount, 0);
    assert.equal(mcpCheck?.status, "warn");
    assert.match(mcpCheck?.message ?? "", /dry-run/);
    assert.doesNotMatch(JSON.stringify(report), /mcp-secret-value/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDoctor warns when enabled MCP servers do not classify tools", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
        mcp: { servers: [{ name: "fs", enabled: true, command: "node" }] },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
    await writeFile(paths.systemPromptPath, "You are Miu.\n");

    const report = await runDoctor(paths);
    const mcpCheck = report.checks.find((check) => check.name === "MCP servers");

    assert.equal(report.issueCount, 0);
    assert.equal(mcpCheck?.status, "warn");
    assert.match(mcpCheck?.message ?? "", /missing tool classification: fs/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createConfiguredPaths(): Promise<RuntimePaths> {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 1,
      agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
      llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");

  return paths;
}

async function writeTelegramConfiguredFiles(paths: RuntimePaths, envValues: Record<string, string>): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 1,
      agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
      llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
      channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
    },
    paths,
  );
  await writeEnvFile(envValues, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}

async function writeZaloConfiguredFiles(paths: RuntimePaths, envValues: Record<string, string>): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 1,
      agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
      llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 60_000 },
      channels: { zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "zalo-owner-1" } },
    },
    paths,
  );
  await writeEnvFile(envValues, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-doctor-test-"));
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
