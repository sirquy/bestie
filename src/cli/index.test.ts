import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { main } from "./index.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { getRuntimePaths } from "../runtime/paths.js";

const execFileAsync = promisify(execFile);

test("main suppresses the banner when BESTIE_NO_BANNER is set", async () => {
  const { stdout } = await captureMain(["node", "bestie"], { BESTIE_NO_BANNER: "1" });

  assert.doesNotMatch(stdout, /____/);
  assert.match(stdout, /Usage:/);
});

test("main renders the static banner when BESTIE_BANNER is static", async () => {
  const { stdout } = await captureMain(["node", "bestie"], { BESTIE_BANNER: "static" });

  assert.match(stdout, /____/);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /chat\s+Bắt đầu chat terminal sau khi onboard/);
  assert.match(stdout, /status\s+Xem trạng thái thiết lập local/);
});

test("main suppresses the banner for memory export JSON", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(["node", "bestie", "memory", "export"], { HOME: homeDir });

    assert.doesNotMatch(stdout, /____/);
    const parsed = JSON.parse(stdout) as { memories: unknown[]; pendingMemories: unknown[]; messages: unknown[] };
    assert.ok(Array.isArray(parsed.memories));
    assert.ok(Array.isArray(parsed.pendingMemories));
    assert.ok(Array.isArray(parsed.messages));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("main suppresses the banner for memory analyze JSON", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(["node", "bestie", "memory", "analyze", "--json"], { HOME: homeDir });

    assert.doesNotMatch(stdout, /____/);
    const parsed = JSON.parse(stdout) as { allowed: boolean; checked: number; duplicateGroups: unknown[]; staleMemories: unknown[]; conflictGroups: unknown[] };
    assert.equal(parsed.allowed, true);
    assert.equal(parsed.checked, 0);
    assert.ok(Array.isArray(parsed.duplicateGroups));
    assert.ok(Array.isArray(parsed.staleMemories));
    assert.ok(Array.isArray(parsed.conflictGroups));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory graph CLI can add search and export graph items", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    await captureMain(["node", "bestie", "memory", "graph", "add", "entity", "person", "User"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    await captureMain(["node", "bestie", "memory", "graph", "add", "entity", "project", "Bestie"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    await captureMain(["node", "bestie", "memory", "graph", "add", "relation", "1", "works_on", "2", "User is building Bestie."], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    const search = await captureMain(["node", "bestie", "memory", "graph", "search", "Bestie"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(search.stdout, /Bestie/);
    assert.match(search.stdout, /works_on/);

    const exported = await captureMain(["node", "bestie", "memory", "graph", "export"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const parsed = JSON.parse(exported.stdout) as { entities: unknown[]; relations: unknown[]; pending: unknown[] };
    assert.equal(parsed.entities.length, 2);
    assert.equal(parsed.relations.length, 1);
    assert.deepEqual(parsed.pending, []);

    const hygiene = await captureMain(["node", "bestie", "memory", "graph", "hygiene", "--json"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const hygieneParsed = JSON.parse(hygiene.stdout) as { checkedEntities: number; checkedRelations: number; score: number };
    assert.equal(hygieneParsed.checkedEntities, 2);
    assert.equal(hygieneParsed.checkedRelations, 1);
    assert.equal(hygieneParsed.score, 100);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory graph CLI can update and forget relations", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    await captureMain(["node", "bestie", "memory", "graph", "add", "entity", "person", "User"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    await captureMain(["node", "bestie", "memory", "graph", "add", "entity", "project", "Bestie"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    await captureMain(["node", "bestie", "memory", "graph", "add", "relation", "1", "works_on", "2", "Initial evidence."], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    const updated = await captureMain(["node", "bestie", "memory", "graph", "update", "relation", "1", "--confidence", "0.72", "--evidence", "Reviewed evidence.", "--scope", "project", "--sensitivity", "sensitive", "--yes"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(updated.stdout, /Knowledge relation updated: #1/);
    assert.match(updated.stdout, /Reviewed evidence/);
    assert.match(updated.stdout, /"confidence": 0.72/);

    const forgot = await captureMain(["node", "bestie", "memory", "graph", "forget", "relation", "1", "--yes"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(forgot.stdout, /Knowledge relation forgotten: #1/);

    const exported = await captureMain(["node", "bestie", "memory", "graph", "export"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const parsed = JSON.parse(exported.stdout) as { relations: unknown[] };
    assert.deepEqual(parsed.relations, []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory graph CLI can inspect approve and reject pending graph items", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addPendingKnowledgeItem({ payload: { entities: [{ name: "Bestie", kind: "project" }], relations: [] }, reason: "Needs graph approval.", source: "test" });
      store.addPendingKnowledgeItem({ payload: { entities: [{ name: "Temporary", kind: "topic" }], relations: [] }, reason: "Reject me.", source: "test" });
    } finally {
      store.close();
    }

    const pending = await captureMain(["node", "bestie", "memory", "graph", "pending"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(pending.stdout, /Pending Knowledge Graph Items/);
    assert.match(pending.stdout, /Bestie/);

    const inspected = await captureMain(["node", "bestie", "memory", "graph", "pending", "inspect", "1"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(inspected.stdout, /Needs graph approval/);

    const approved = await captureMain(["node", "bestie", "memory", "graph", "approve", "1"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(approved.stdout, /Pending knowledge graph item approved/);

    const rejected = await captureMain(["node", "bestie", "memory", "graph", "reject", "2"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(rejected.stdout, /Pending knowledge graph item rejected/);

    const exported = await captureMain(["node", "bestie", "memory", "graph", "export"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const parsed = JSON.parse(exported.stdout) as { entities: Array<{ canonicalName: string }>; pending: unknown[] };
    assert.deepEqual(parsed.entities.map((entity) => entity.canonicalName), ["Bestie"]);
    assert.deepEqual(parsed.pending, []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory graph CLI reports duplicate candidates and merges entities", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
      const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"] });
      const duplicate = store.upsertKnowledgeEntity({ canonicalName: "bestie-agent", kind: "project" });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: duplicate.id });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "likes", targetEntityId: bestie.id });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "dislikes", targetEntityId: bestie.id });
    } finally {
      store.close();
    }

    const hygiene = await captureMain(["node", "bestie", "memory", "graph", "hygiene"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(hygiene.stdout, /possible duplicate entity pair/);
    assert.match(hygiene.stdout, /relation conflict/);

    const review = await captureMain(["node", "bestie", "memory", "graph", "review", "--limit", "1"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(review.stdout, /Knowledge Graph Review/);
    assert.match(review.stdout, /Merge duplicate project entities/);
    assert.match(review.stdout, /bestie memory graph merge entity (2 3|3 2) --yes/);

    const reviewJson = await captureMain(["node", "bestie", "memory", "graph", "review", "--json", "--limit", "1"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const reviewParsed = JSON.parse(reviewJson.stdout) as { plan: { suggestions: Array<{ action: string }> } };
    assert.deepEqual(reviewParsed.plan.suggestions.map((suggestion) => suggestion.action), ["merge_entity"]);

    const merged = await captureMain(["node", "bestie", "memory", "graph", "merge", "entity", "2", "3", "--yes"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    assert.match(merged.stdout, /Knowledge entity merged: #2 <- #3/);

    const exported = await captureMain(["node", "bestie", "memory", "graph", "export"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const parsed = JSON.parse(exported.stdout) as { entities: Array<{ id: number; aliases: string[] }>; relations: Array<{ targetEntityId: number }> };
    assert.deepEqual(parsed.entities.map((entity) => entity.id), [2, 1]);
    assert.deepEqual(parsed.entities.find((entity) => entity.id === 2)?.aliases, ["Bestie Agent", "bestie-agent"]);
    assert.ok(parsed.relations.some((relation) => relation.targetEntityId === 2));
    assert.equal(parsed.relations.some((relation) => relation.targetEntityId === 3), false);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory cleanup dry-run JSON reports planned deletions", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Duplicate memory", importance: 4 });
      store.addMemory({ type: "project_context", content: "Duplicate memory", importance: 1 });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "cleanup", "--dry-run", "--json"], { HOME: homeDir });
    const parsed = JSON.parse(stdout) as { allowed: boolean; applied: boolean; plan: { deleteIds: number[] } };

    assert.equal(parsed.allowed, true);
    assert.equal(parsed.applied, false);
    assert.deepEqual(parsed.plan.deleteIds, [2]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory cleanup apply defaults to ask without deleting", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Duplicate memory", importance: 4 });
      store.addMemory({ type: "project_context", content: "Duplicate memory", importance: 1 });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "cleanup", "--apply", "--json"], { HOME: homeDir });
    const parsed = JSON.parse(stdout) as { allowed: boolean; applied: boolean; reason: string; plan: { deleteIds: number[] } };

    assert.equal(parsed.allowed, false);
    assert.equal(parsed.applied, false);
    assert.match(parsed.reason, /deletePolicy is ask/);
    assert.deepEqual(parsed.plan.deleteIds, [2]);

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(verifyStore.listActiveMemories().length, 2);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory maintenance install creates a cron report schedule", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(
      ["node", "bestie", "memory", "maintenance", "install", "--channel", "telegram:123", "--schedule", "0 9 * * 1"],
      { HOME: homeDir, BESTIE_NO_BANNER: "1" },
    );

    assert.match(stdout, /Memory maintenance report installed/);

    const store = await SqliteMemoryStore.open(getRuntimePaths(homeDir));
    try {
      const [schedule] = store.listCronSchedules();
      assert.equal(schedule.name, "Bestie memory maintenance report");
      assert.equal(schedule.scheduleType, "cron_expr");
      assert.equal(schedule.scheduleValue, "0 9 * * 1");
      assert.equal(schedule.channel, "telegram:123");
      assert.match(schedule.prompt, /internal\.plan_memory_hygiene/);
      assert.match(schedule.prompt, /internal\.memory_hygiene_trend/);
      assert.match(schedule.prompt, /internal\.plan_memory_rebalance/);
      assert.match(schedule.prompt, /deleteIds/);
      assert.match(schedule.prompt, /\/memory hygiene apply confirm/);
      assert.match(schedule.prompt, /\/memory rebalance apply confirm/);
    } finally {
      store.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory maintenance remove deletes the installed cron report schedule", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    await captureMain(["node", "bestie", "memory", "maintenance", "install", "--channel", "zalo:owner"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const { stdout } = await captureMain(["node", "bestie", "memory", "maintenance", "remove"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory maintenance report removed/);

    const store = await SqliteMemoryStore.open(getRuntimePaths(homeDir));
    try {
      assert.equal(store.listCronSchedules().length, 0);
    } finally {
      store.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory governance policy updates retrieval policy in config", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(createTestConfig(), null, 2)}\n`, { mode: 0o600 });

    const { stdout } = await captureMain(["node", "bestie", "memory", "governance", "policy", "governed"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const updated = JSON.parse(await readFile(paths.configPath, "utf8")) as { memory?: { retrievalPolicy?: string } };

    assert.match(stdout, /memory\.retrievalPolicy set to governed/);
    assert.equal(updated.memory?.retrievalPolicy, "governed");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene reports dry-run cleanup and review ids", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Duplicate hygiene CLI", importance: 5 });
      store.addMemory({ type: "project_context", content: "Duplicate hygiene CLI", importance: 1 });
      store.addMemory({ type: "project_context", content: "Expired hygiene CLI", expiresAt: "2020-01-01T00:00:00.000Z" });
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Planned Memory Hygiene \(5 checked\)/);
    assert.match(stdout, /#2, #3/);
    assert.match(stdout, /Review-only memories: #4, #5/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene status reports policies and next command", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(Object.assign({}, createTestConfig(), { memory: { deletePolicy: "ask", retrievalPolicy: "governed" } }), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Status hygiene CLI", importance: 5 });
      store.addMemory({ type: "project_context", content: "Status hygiene CLI", importance: 1 });
      store.addMemory({ type: "project_context", content: "Expired status CLI", expiresAt: "2020-01-01T00:00:00.000Z" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene", "status"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory hygiene status \(3 checked\)/);
    assert.match(stdout, /Memory hygiene score: \d+\/100 \((healthy|attention|needs cleanup)\)/);
    assert.match(stdout, /Retrieval policy: governed/);
    assert.match(stdout, /Delete policy: ask/);
    assert.match(stdout, /Delete candidates: 2 \(#2, #3\)/);
    assert.match(stdout, /Next safe command: bestie memory hygiene --apply --yes/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene trend reports recent score snapshots", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(createTestConfig(), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemoryHygieneSnapshot({ score: 74, label: "attention", checked: 8, deleteCandidates: 2, reviewOnly: 1, duplicateGroups: 1, staleMemories: 1, conflictGroups: 0, source: "test:first" });
      store.addMemoryHygieneSnapshot({ score: 88, label: "healthy", checked: 8, deleteCandidates: 0, reviewOnly: 1, duplicateGroups: 0, staleMemories: 0, conflictGroups: 0, source: "test:latest" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene", "trend"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory hygiene trend \(2 snapshot\(s\)\)/);
    assert.match(stdout, /Latest: #2 88\/100 \(healthy\)/);
    assert.match(stdout, /Direction: up \(\+14\) from #1/);
    assert.match(stdout, /#1 74\/100 \(attention\)/);

    const json = await captureMain(["node", "bestie", "memory", "hygiene", "trend", "--json"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const parsed = JSON.parse(json.stdout) as { direction: string; delta: number; snapshots: unknown[] };
    assert.equal(parsed.direction, "up");
    assert.equal(parsed.delta, 14);
    assert.equal(parsed.snapshots.length, 2);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene doctor reports risky memory governance settings", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(Object.assign({}, createTestConfig(), { memory: { deletePolicy: "allow", retrievalPolicy: "full" } }), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene", "doctor"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory hygiene doctor: \d+ issue\(s\)/);
    assert.match(stdout, /Memory hygiene score: \d+\/100 \((healthy|attention|needs cleanup)\)/);
    assert.match(stdout, /\[WARN\] Delete policy: memory\.deletePolicy is allow while 2 memory\/memories require review-only handling\./);
    assert.match(stdout, /\[WARN\] Maintenance digest: Weekly memory hygiene digest is not installed\./);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene doctor fix installs maintenance digest and skips unsafe fixes", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(Object.assign({}, createTestConfig(), { memory: { deletePolicy: "allow", retrievalPolicy: "full" } }), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene", "doctor", "--fix"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory hygiene doctor fixes/);
    assert.match(stdout, /\[FIXED\] Maintenance digest: Installed weekly memory hygiene digest: #\d+\./);
    assert.match(stdout, /\[SKIPPED\] Delete policy:/);
    assert.match(stdout, /\[PASS\] Maintenance digest: Weekly memory hygiene digest is installed\./);
    assert.match(stdout, /Memory hygiene score: \d+\/100 \((healthy|attention|needs cleanup)\)/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      const [schedule] = checkStore.listCronSchedules();
      assert.equal(schedule.name, "Bestie memory maintenance report");
      assert.match(schedule.prompt, /internal\.plan_memory_hygiene/);
      assert.match(schedule.prompt, /internal\.memory_hygiene_trend/);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory hygiene apply deletes planned ids when policy allows", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(Object.assign({}, createTestConfig(), { memory: { deletePolicy: "allow" } }), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Duplicate hygiene apply", importance: 5 });
      store.addMemory({ type: "project_context", content: "Duplicate hygiene apply", importance: 1 });
      store.addMemory({ type: "project_context", content: "Expired hygiene apply", expiresAt: "2020-01-01T00:00:00.000Z" });
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "hygiene", "--apply"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Applied Memory Hygiene \(5 checked\)/);
    assert.match(stdout, /Deleted 2 planned memory/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getActiveMemory(1)?.content, "Duplicate hygiene apply");
      assert.equal(checkStore.getActiveMemory(2), undefined);
      assert.equal(checkStore.getActiveMemory(3), undefined);
      assert.equal(checkStore.getActiveMemory(4)?.content, "Use voice replies");
      assert.equal(checkStore.getActiveMemory(5)?.content, "Do not use voice replies");
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory pin and unpin update active memory metadata", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "preference", content: "Pinned via CLI" }).id;
    } finally {
      store.close();
    }

    const pinned = await captureMain(["node", "bestie", "memory", "pin", String(id)], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const unpinned = await captureMain(["node", "bestie", "memory", "unpin", String(id)], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.match(pinned.stdout, /Memory pinned/);
      assert.match(unpinned.stdout, /Memory unpinned/);
      assert.equal(checkStore.getActiveMemory(id)?.pinned, false);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory list scope and move manage memory tiers", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "preference", content: "Tiered memory" }).id;
      store.addMemory({ type: "project_context", content: "Project tier" });
    } finally {
      store.close();
    }

    const coreList = await captureMain(["node", "bestie", "memory", "list", "--scope", "core"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const moved = await captureMain(["node", "bestie", "memory", "move", String(id), "--scope", "session"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const sessionList = await captureMain(["node", "bestie", "memory", "list", "--scope", "session"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const tiers = await captureMain(["node", "bestie", "memory", "tiers"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const rebalance = await captureMain(["node", "bestie", "memory", "rebalance", "--dry-run"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(coreList.stdout, /Active Memories \/ core/);
    assert.match(coreList.stdout, /Tiered memory/);
    assert.match(moved.stdout, /moved to session/);
    assert.match(sessionList.stdout, /Active Memories \/ session/);
    assert.match(sessionList.stdout, /Tiered memory/);
    assert.match(tiers.stdout, /Memory tiers \(2 active\)/);
    assert.match(tiers.stdout, /project: 1 active/);
    assert.match(tiers.stdout, /session: 1 active/);
    assert.match(tiers.stdout, /Next: bestie memory list --scope session/);
    assert.match(rebalance.stdout, /Memory rebalance dry-run \(2 checked\)/);
    assert.match(rebalance.stdout, new RegExp(`#${id} \\[preference\\] session -> core`));
    assert.match(rebalance.stdout, /Next: bestie memory move <id> core\|project\|session/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory rebalance apply moves only non-review-only recommendations", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(Object.assign({}, createTestConfig(), { memory: { deletePolicy: "allow" } }), null, 2)}\n`, { mode: 0o600 });
    const store = await SqliteMemoryStore.open(paths);
    let projectId: number;
    let pinnedId: number;
    try {
      projectId = store.addMemory({ type: "project_context", content: "Wrong core project", scope: "core" }).id;
      pinnedId = store.addMemory({ type: "one_off", content: "Pinned one-off", scope: "core", pinned: true }).id;
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "rebalance", "--apply", "--yes"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory rebalance applied: 1 moved/);
    assert.match(stdout, new RegExp(`#${projectId} core->project`));
    assert.match(stdout, new RegExp(`Review-only skipped: #${pinnedId}`));

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getActiveMemory(projectId)?.scope, "project");
      assert.equal(checkStore.getActiveMemory(pinnedId)?.scope, "core");
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory supersede marks an active memory as replaced", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    let oldId: number;
    let newId: number;
    try {
      oldId = store.addMemory({ type: "project_context", content: "Old CLI project fact" }).id;
      newId = store.addMemory({ type: "project_context", content: "New CLI project fact" }).id;
    } finally {
      store.close();
    }

    const result = await captureMain(["node", "bestie", "memory", "supersede", String(oldId), String(newId)], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.match(result.stdout, new RegExp(`Memory ${oldId} superseded by ${newId}`));
      assert.equal(checkStore.getActiveMemory(oldId)?.supersededBy, newId);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("NO_COLOR disables ANSI color in human output", async () => {
  const { stdout } = await captureMain(["node", "bestie", "skills"], { BESTIE_NO_BANNER: "1", NO_COLOR: "1" });

  assert.doesNotMatch(stdout, /\x1b\[[0-9;]*m/);
});

test("nested command help is available for channels and MCP", async () => {
  const env = { BESTIE_NO_BANNER: "1" };
  const channelsHelp = await captureMain(["node", "bestie", "channels", "-h"], env);
  const mcpHelp = await captureMain(["node", "bestie", "mcp", "-h"], env);
  const telegramHelp = await captureMain(["node", "bestie", "channels", "telegram", "-h"], env);

  assert.match(channelsHelp.stdout, /Usage: bestie channels/);
  assert.match(channelsHelp.stdout, /telegram\s+Khởi động hoặc cấu hình channel adapter Telegram/);
  assert.match(mcpHelp.stdout, /Usage: bestie mcp/);
  assert.match(mcpHelp.stdout, /classify <server> <tool>/);
  assert.match(telegramHelp.stdout, /Usage: bestie channels telegram/);
  assert.match(telegramHelp.stdout, /voice\s+Alias cho lệnh voice dùng chung/);
});

test("linked bin entrypoint runs through npm symlinks", async () => {
  const linkedBin = await mkdtemp(resolve(tmpdir(), "bestie-linked-bin-test-"));
  const symlinkPath = resolve(linkedBin, "bestie");

  try {
    await symlink(resolve(process.cwd(), "dist/cli/index.js"), symlinkPath);
    const { stdout } = await execFileAsync(symlinkPath, ["--help"], { env: { ...process.env, BESTIE_BANNER: "static" } });

    assert.match(stdout, /Usage:/);
  } finally {
    await rm(linkedBin, { recursive: true, force: true });
  }
});

async function captureMain(argv: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const originalEnv: Record<string, string | undefined> = {};
  const stdout: string[] = [];
  const stderr: string[] = [];

  for (const key of Object.keys(env)) {
    originalEnv[key] = process.env[key];
    process.env[key] = env[key];
  }

  console.log = (message?: unknown) => stdout.push(String(message ?? ""));
  console.error = (message?: unknown) => stderr.push(String(message ?? ""));

  try {
    await main(argv);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function createTestConfig(): unknown {
  return {
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
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
    memory: { writePolicy: "ask", deletePolicy: "ask" },
  };
}
