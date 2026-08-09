import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { runUiOnboarding } from "./onboarding.js";

test("runUiOnboarding creates a complete local runtime without exposing its secret", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-onboarding-"));
  const paths = getRuntimePaths(rootDir);

  try {
    const result = await runUiOnboarding({
      paths,
      agentName: "Miu",
      ownerName: "Quỳnh",
      provider: "openai",
      model: "gpt-4.1-mini",
      secret: "sk-test-secret",
      timeZone: "Asia/Ho_Chi_Minh",
    });

    assert.equal(result.ok, true);
    assert.equal(result.modelRef, "openai/gpt-4.1-mini");
    const config = await loadConfig(paths);
    assert.equal(config.agent.name, "Miu");
    assert.equal(config.agent.ownerName, "Quỳnh");
    assert.equal(config.llm.primary, result.modelRef);
    assert.equal((await loadEnvFile(paths)).OPENAI_API_KEY, "sk-test-secret");
    assert.match(await readFile(paths.characterPath, "utf8"), /"Miu"/);
    assert.match(await readFile(paths.systemPromptPath, "utf8"), /You are Miu/);
    assert.doesNotMatch(JSON.stringify(result), /sk-test-secret/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runUiOnboarding supports local Ollama without an API key", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-onboarding-"));
  const paths = getRuntimePaths(rootDir);

  try {
    const result = await runUiOnboarding({ paths, agentName: "Bestie", ownerName: "Boss", provider: "ollama" });
    assert.equal(result.modelRef, "ollama/llama3.1");
    assert.deepEqual(await loadEnvFile(paths), {});
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runUiOnboarding does not overwrite an existing runtime", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-onboarding-"));
  const paths = getRuntimePaths(rootDir);

  try {
    await runUiOnboarding({ paths, agentName: "Bestie", ownerName: "Boss", provider: "ollama" });
    await assert.rejects(
      runUiOnboarding({ paths, agentName: "Replacement", ownerName: "Boss", provider: "ollama" }),
      /already configured/,
    );
    assert.equal((await loadConfig(paths)).agent.name, "Bestie");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
