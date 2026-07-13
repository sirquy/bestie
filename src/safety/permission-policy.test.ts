import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../runtime/paths.js";
import { evaluateActionPermission, logActionPermission, reviewActionPermission } from "./permission-policy.js";

test("evaluateActionPermission allows trusted read-only actions by default", () => {
  assert.deepEqual(evaluateActionPermission({ category: "read", action: "list files", trusted: true }), {
    decision: "allow",
    reason: "Trusted read-only actions are allowed by default.",
  });
});

test("evaluateActionPermission asks for untrusted read and local writes", () => {
  assert.deepEqual(evaluateActionPermission({ category: "read", action: "read URL" }).decision, "ask");
  assert.deepEqual(evaluateActionPermission({ category: "local_write", action: "write note" }).decision, "ask");
});

test("evaluateActionPermission requires approval for risky action categories", () => {
  for (const category of ["external_write", "public_action", "destructive", "money", "unknown"] as const) {
    const result = evaluateActionPermission({ category, action: `test ${category}` });

    assert.equal(result.decision, "ask");
    assert.match(result.reason, /explicit approval/);
  }
});

test("evaluateActionPermission denies empty action names", () => {
  assert.deepEqual(evaluateActionPermission({ category: "read", action: "   ", trusted: true }), {
    decision: "deny",
    reason: "Empty action names are denied.",
  });
});

test("logActionPermission writes redacted audit metadata", async () => {
  const paths = await createTempPaths();

  try {
    const request = { category: "external_write" as const, action: "post webhook", target: "token=super-secret-token-12345678901234567890" };
    const result = evaluateActionPermission(request);

    await logActionPermission(request, result, { paths, knownSecrets: ["super-secret-token-12345678901234567890"] });

    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /action_permission_decision/);
    assert.match(logText, /external_write/);
    assert.match(logText, /ask/);
    assert.doesNotMatch(logText, /super-secret-token/);
    assert.match(logText, /\[REDACTED]/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("reviewActionPermission returns allowed policy decisions without asking", async () => {
  let asked = false;
  const result = await reviewActionPermission(
    { category: "read", action: "list local files", trusted: true },
    {
      approver: async () => {
        asked = true;
        return { approved: false };
      },
    },
  );

  assert.equal(result.decision, "allow");
  assert.equal(asked, false);
});

test("reviewActionPermission denies ask decisions when no approver exists", async () => {
  const paths = await createTempPaths();

  try {
    const result = await reviewActionPermission({ category: "local_write", action: "write note" }, { paths });

    assert.equal(result.decision, "deny");
    assert.match(result.reason, /no approver/);
    assert.match(await readFile(paths.appLogPath, "utf8"), /action_permission_decision/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("reviewActionPermission uses approver decisions for ask outcomes", async () => {
  const approved = await reviewActionPermission(
    { category: "external_write", action: "send webhook" },
    { approver: async () => ({ approved: true, reason: "Owner approved this webhook." }) },
  );
  const denied = await reviewActionPermission(
    { category: "destructive", action: "delete data" },
    { approver: async () => ({ approved: false, reason: "Owner rejected deletion." }) },
  );

  assert.deepEqual(approved, { decision: "allow", reason: "Owner approved this webhook." });
  assert.deepEqual(denied, { decision: "deny", reason: "Owner rejected deletion." });
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-permission-test-"));
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