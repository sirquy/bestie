import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderFallbackError, ProviderTimeoutError } from "./errors.js";
import { fallbackLogDetail, formatProviderFallbackDiagnostics, formatProviderFallbackHealth, ProviderFallbackRecorder } from "./fallbacks.js";

test("ProviderFallbackRecorder builds fallback errors with attempt details", () => {
  const recorder = new ProviderFallbackRecorder();
  const timeoutError = new ProviderTimeoutError(60_000);

  recorder.record({ provider: "openai-compatible", model: "primary-model" }, new Error("primary failed"));
  recorder.record({ provider: "openai-compatible", model: "fallback-model" }, timeoutError);

  const error = recorder.toError();

  assert.ok(error instanceof ProviderFallbackError);
  assert.equal(error.finalError, timeoutError);
  assert.deepEqual(error.attempts, [
    { provider: "openai-compatible", model: "primary-model", error: "primary failed" },
    { provider: "openai-compatible", model: "fallback-model", error: timeoutError.message },
  ]);
});

test("fallbackLogDetail only exposes attempts for ProviderFallbackError", () => {
  const fallbackError = new ProviderFallbackError(
    [{ provider: "openai-compatible", model: "primary-model", error: "failed" }],
    new Error("failed"),
  );

  assert.deepEqual(fallbackLogDetail(fallbackError), {
    fallbackAttempts: [{ provider: "openai-compatible", model: "primary-model", error: "failed" }],
  });
  assert.deepEqual(fallbackLogDetail(new Error("plain error")), {});
});

test("formatProviderFallbackHealth summarizes recent fallback attempts", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await appendFile(paths.appLogPath, "not json\n");
    await appendLog({ event: "chat_request_failure", detail: { message: "plain failure" } }, { paths });
    await appendLog(
      {
        event: "chat_request_failure",
        detail: {
          message: "fallback failure",
          fallbackAttempts: [
            { provider: "openai-compatible", model: "primary-model", error: "502" },
            { provider: "openai-compatible", model: "fallback-model", error: "timeout" },
            { provider: "openai-compatible", model: "primary-model", error: "429" },
            { provider: "elevenlabs", model: "scribe_v2", error: "500" },
            { provider: "local-whisper", model: "whisper", error: "exit 1" },
            { provider: "bad", model: "missing-error" },
          ],
        },
      },
      { paths },
    );

    assert.equal(
      await formatProviderFallbackHealth(paths),
      "provider fallback failures recent 5 (openai-compatible/primary-model x2, elevenlabs/scribe_v2 x1, local-whisper/whisper x1)",
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("formatProviderFallbackHealth returns undefined without fallback attempts", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "not json\n", { mode: 0o600 });
    await appendLog({ event: "chat_request_failure", detail: { message: "plain failure" } }, { paths });

    assert.equal(await formatProviderFallbackHealth(paths), undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("formatProviderFallbackDiagnostics lists recent fallback chains", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await appendLog(
      {
        event: "chat_request_failure",
        detail: {
          fallbackAttempts: [
            { provider: "openai-compatible", model: "old-primary", error: "502" },
            { provider: "openai-compatible", model: "old-fallback", error: "timeout" },
          ],
        },
      },
      { paths },
    );
    await appendLog(
      {
        event: "telegram_chat_failure",
        detail: {
          fallbackAttempts: [
            { provider: "openai-compatible", model: "new-primary", error: "429" },
            { provider: "elevenlabs", model: "scribe_v2", error: "500" },
          ],
        },
      },
      { paths },
    );

    const diagnostics = await formatProviderFallbackDiagnostics(paths, 80, 1);

    assert.match(diagnostics, /^Provider diagnostics -> recent fallback chains 1/);
    assert.match(diagnostics, /openai-compatible\/new-primary: 429/);
    assert.match(diagnostics, /elevenlabs\/scribe_v2: 500/);
    assert.doesNotMatch(diagnostics, /old-primary/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("formatProviderFallbackDiagnostics redacts and truncates display errors", async () => {
  const paths = await createTempPaths();
  const longError = `Provider rejected token sk-secretvalue123456 with payload ${"x".repeat(220)}`;

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await appendLog(
      {
        event: "chat_request_failure",
        detail: {
          fallbackAttempts: [
            { provider: "openai-compatible", model: "primary-model", error: `Bearer abc123token\n${longError}` },
          ],
        },
      },
      { paths },
    );

    const diagnostics = await formatProviderFallbackDiagnostics(paths);
    const errorLine = diagnostics.split("\n").at(1) ?? "";

    assert.match(errorLine, /Bearer \[REDACTED\]/);
    assert.match(errorLine, /\[REDACTED\]/);
    assert.doesNotMatch(errorLine, /sk-secretvalue123456/);
    assert.ok(errorLine.length < 260);
    assert.match(errorLine, /\.\.\.$/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("formatProviderFallbackDiagnostics reports empty history", async () => {
  const paths = await createTempPaths();

  try {
    assert.equal(await formatProviderFallbackDiagnostics(paths), "Provider diagnostics -> no recent fallback failures found.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-fallbacks-test-"));
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
