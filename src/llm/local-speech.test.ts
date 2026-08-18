import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createTestConfig } from "../test-support/config.js";
import { createLocalSpeech } from "./local-speech.js";

test("createLocalSpeech runs a local command and returns its WAV output", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-local-speech-"));
  try {
    const scriptPath = resolve(rootDir, "speech.mjs");
    await writeFile(scriptPath, 'import { writeFileSync } from "node:fs"; const output = process.argv.at(-1); process.stdin.resume(); process.stdin.on("end", () => writeFileSync(output, Buffer.from("RIFFtestWAVE")));');
    const speech = await createLocalSpeech(createTestConfig({ speech: { provider: "local-command", command: process.execPath, args: [scriptPath, "--model", "{modelPath}", "--output_file", "{outputPath}"], modelPath: "models/voice.onnx" } }), "xin chào", { rootDir });

    assert.equal(speech.mimeType, "audio/wav");
    assert.deepEqual([...speech.bytes], [...Buffer.from("RIFFtestWAVE")]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
