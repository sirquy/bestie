import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { ProviderResponseError } from "./errors.js";
import { buildLocalWhisperArgs, createLocalAudioTranscription } from "./local-transcription.js";

const baseConfig: AppConfig = {
  version: 2,
  agent: { name: "Miu", ownerName: "Sep", language: "vi", toneIntensity: 7 },
  llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
};

test("buildLocalWhisperArgs substitutes paths without shell parsing", () => {
  assert.deepEqual(
    buildLocalWhisperArgs(["-m", "{modelPath}", "-f", "{audioPath}", "literal space"], {
      audioPath: "/tmp/audio file.ogg",
      modelPath: "/tmp/model.bin",
    }),
    ["-m", "/tmp/model.bin", "-f", "/tmp/audio file.ogg", "literal space"],
  );
});

test("createLocalAudioTranscription runs configured local command and reads stdout", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-local-transcription-test-"));

  try {
    const scriptPath = resolve(rootDir, "fake-whisper.mjs");
    const audioPath = resolve(rootDir, "voice secret.ogg");
    const modelPath = resolve(rootDir, "ggml-small.bin");
    await writeFile(audioPath, new Uint8Array([1, 2, 3]));
    await writeFile(modelPath, new Uint8Array([4, 5, 6]));
    await writeFile(
      scriptPath,
      `const args = process.argv.slice(2);\nif (!args.includes(${JSON.stringify(audioPath)}) || !args.includes(${JSON.stringify(modelPath)})) process.exit(9);\nprocess.stdout.write("xin chao local whisper\\n");\n`,
    );

    const text = await createLocalAudioTranscription(
      {
        ...baseConfig,
        transcription: {
          provider: "local-whisper",
          command: process.execPath,
          args: [scriptPath, "-m", "{modelPath}", "-f", "{audioPath}"],
          modelPath,
        },
      },
      { localPath: audioPath },
    );

    assert.equal(text, "xin chao local whisper");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("createLocalAudioTranscription rejects empty stdout", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-local-transcription-test-"));

  try {
    const scriptPath = resolve(rootDir, "empty-whisper.mjs");
    await writeFile(scriptPath, "process.stdout.write('   ');\n");

    await assert.rejects(
      () =>
        createLocalAudioTranscription(
          {
            ...baseConfig,
            transcription: {
              provider: "local-whisper",
              command: process.execPath,
              args: [scriptPath, "-f", "{audioPath}"],
              modelPath: resolve(rootDir, "model.bin"),
            },
          },
          { localPath: resolve(rootDir, "voice.ogg") },
        ),
      ProviderResponseError,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
