import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../../runtime/paths.js";
import { hashContent, hashSkillRegistry, type CuratedSkillTemplate } from "../../skills/library.js";
import { clearUiSkillRemoteRegistryCache, deleteUiSkill, getUiSkill, getUiSkillLibrary, getUiSkillLibraryDiff, getUiSkillLibraryItem, getUiSkillsSummary, installUiSkillFromLibrary, rollbackUiSkill, testUiSkillRemoteRegistry, toggleUiSkillEnabled, writeUiSkill } from "./skills.js";

test("getUiSkillLibrary exposes curated metadata and installed state", async () => {
  const paths = await createTempPaths();

  try {
    const library = await getUiSkillLibrary(paths);
    assert.equal(library.ok, true);
    assert.ok(library.count >= 6);
    assert.equal(library.installedCount, 0);
    assert.equal(library.registry.activeSource.id, "bestie-official-github");
    assert.equal(library.registry.activeSource.verification.status, "verified");
    assert.equal(library.registry.validation.ok, true);
    assert.match(library.registry.registryHash, /^[a-f0-9]{64}$/);
    assert.ok(library.registry.sources.some((source) => source.id === "bestie-official-github" && source.enabled === true));

    const firecrawl = library.skills.find((skill) => skill.name === "firecrawl");
    assert.equal(firecrawl?.trust, "official");
    assert.equal(firecrawl?.risk, "medium");
    assert.deepEqual(firecrawl?.permissions, ["network"]);
    assert.equal(firecrawl?.installed, false);
    assert.equal(firecrawl?.sourceId, "bestie-official-github");
    assert.equal(firecrawl?.verificationStatus, "verified");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("getUiSkillLibrary reports configured remote registry verification contract", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify({
      version: 2,
      agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_API_KEY" } },
        modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
      },
      skills: { registry: { remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", publicKey: "test-public-key" } } },
    }, null, 2)}\n`);

    await rm(resolve(paths.dataDir, "skill-remote-registry-cache.json"), { force: true });
    const library = await getUiSkillLibrary(paths);
    const remote = library.registry.activeSource;
    assert.equal(remote.enabled, true);
    assert.equal(remote.verification.status, "unsigned");
    assert.match(remote.verification.detail, /skills\.example\.test/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("getUiSkillLibrary defaults an omitted remote install policy to ask", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify({
      version: 2,
      agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_API_KEY" } },
        modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
      },
      skills: { registry: { remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", checksumUrl: "https://skills.example.test/registry.sha256" } } },
    }, null, 2)}\n`);

    const library = await getUiSkillLibrary(paths);
    assert.equal(library.skills.find((skill) => skill.name === "firecrawl")?.installable, true);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("testUiSkillRemoteRegistry verifies configured signed remote payload", async () => {
  const paths = await createTempPaths();
  const keys = createTestKeys();
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const signature = signPayload(payload, keys.privateKey);

  try {
    await writeConfigWithRemoteRegistry(paths, { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", installPolicy: "deny" });
    await assert.rejects(() => testUiSkillRemoteRegistry({ confirm: false, paths }), /confirm=true/);

    const result = await testUiSkillRemoteRegistry({
      confirm: true,
      paths,
      fetchImpl: async () => new Response(payload, { status: 200, headers: { "x-bestie-signature": signature } }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.configured, true);
    assert.equal(result.enabled, true);
    assert.equal(result.source?.verification.status, "verified");
    assert.equal(result.validation?.ok, true);
    assert.match(result.registryHash ?? "", /^[a-f0-9]{64}$/);

    const library = await getUiSkillLibrary(paths);
    const remoteSkill = library.skills.find((skill) => skill.name === "remote-test-skill");
    assert.equal(remoteSkill?.sourceId, "remote-official-test");
    assert.equal(remoteSkill?.readOnly, true);
    assert.equal(remoteSkill?.installable, false);
    assert.equal(remoteSkill?.cache?.status, "fresh");
    assert.match(remoteSkill?.cache?.cachedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    const remoteSource = library.registry.sources.find((source) => source.id === "remote-official-test");
    assert.equal(remoteSource?.cache?.status, "fresh");
    assert.match(remoteSource?.cache?.cachedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

    const item = await getUiSkillLibraryItem("remote-test-skill", paths, "remote-official-test");
    assert.equal(item.skill.name, "remote-test-skill");
    assert.match(item.content, /# Remote Test Skill/);

    const cachePath = resolve(paths.dataDir, "skill-remote-registry-cache.json");
    const tamperedCache = JSON.parse(await readFile(cachePath, "utf8"));
    tamperedCache.skills[0].content = "# Tampered Remote Skill\n\nThis cache edit should be ignored.\n";
    await writeFile(cachePath, `${JSON.stringify(tamperedCache, null, 2)}\n`);
    const tamperedLibrary = await getUiSkillLibrary(paths);
    assert.equal(tamperedLibrary.skills.some((skill) => skill.sourceId === "remote-official-test"), false);
    await assert.rejects(() => getUiSkillLibraryItem("remote-test-skill", paths, "remote-official-test"), /not found/);

    await testUiSkillRemoteRegistry({
      confirm: true,
      paths,
      fetchImpl: async () => new Response(payload, { status: 200, headers: { "x-bestie-signature": signature } }),
    });

    await assert.rejects(() => clearUiSkillRemoteRegistryCache({ confirm: false, paths }), /confirm=true/);
    const cleared = await clearUiSkillRemoteRegistryCache({ confirm: true, paths });
    assert.equal(cleared.registry.sources.find((source) => source.id === "remote-official")?.cache, undefined);
    assert.equal(cleared.skills.some((skill) => skill.sourceId === "remote-official-test"), false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("installUiSkillFromLibrary installs verified remote skills only when policy asks", async () => {
  const paths = await createTempPaths();
  const keys = createTestKeys();
  const payload = JSON.stringify(createRemoteRegistryDocument());
  const signature = signPayload(payload, keys.privateKey);

  try {
    await writeConfigWithRemoteRegistry(paths, { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", installPolicy: "deny" });
    await testUiSkillRemoteRegistry({ confirm: true, paths, fetchImpl: async () => new Response(payload, { status: 200, headers: { "x-bestie-signature": signature } }) });
    await assert.rejects(() => installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths }), /chưa cho phép/i);

    await writeConfigWithRemoteRegistry(paths, { enabled: false, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", installPolicy: "ask" });
    const disabledLibrary = await getUiSkillLibrary(paths);
    assert.equal(disabledLibrary.skills.length, 0);
    await assert.rejects(() => installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths }), /not found/);

    await writeConfigWithRemoteRegistry(paths, { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", installPolicy: "ask" });
    await testUiSkillRemoteRegistry({ confirm: true, paths, fetchImpl: async () => new Response(payload, { status: 200, headers: { "x-bestie-signature": signature } }) });
    const library = await getUiSkillLibrary(paths);
    const remoteSkill = library.skills.find((skill) => skill.name === "remote-test-skill");
    assert.equal(remoteSkill?.installable, true);
    assert.equal(remoteSkill?.readOnly, false);

    await installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths });
    const installed = await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "SKILL.md"), "utf8");
    assert.match(installed, /# Remote Test Skill/);
    const manifest = JSON.parse(await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "bestie-skill.json"), "utf8"));
    assert.equal(manifest.source, "remote");
    assert.equal(manifest.sourceId, "remote-official-test");
    assert.equal(manifest.sourceName, "Remote Official Test");

    await writeFile(resolve(paths.appDir, "skills", "remote-test-skill", "SKILL.md"), "# Remote Test Skill\n\nLocal remote edit.\n");
    const diff = await getUiSkillLibraryDiff("remote-test-skill", paths);
    assert.equal(diff.name, "remote-test-skill");
    assert.equal(diff.localChanges, true);
    assert.equal(diff.updateAvailable, true);
    assert.ok(diff.preview.some((line) => line.kind === "added" && line.text.includes("Use only in tests")));

    await installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths });
    const updated = await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "SKILL.md"), "utf8");
    assert.match(updated, /Use only in tests/);

    await rollbackUiSkill({ name: "remote-test-skill", confirm: true, paths });
    const restored = await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "SKILL.md"), "utf8");
    assert.match(restored, /Local remote edit/);
    const rollbackManifest = JSON.parse(await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "bestie-skill.json"), "utf8"));
    assert.equal(rollbackManifest.source, "remote");
    assert.equal(rollbackManifest.sourceId, "remote-official-test");
    assert.equal(rollbackManifest.sourceName, "Remote Official Test");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("installUiSkillFromLibrary requires confirmation and writes SKILL.md", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(() => installUiSkillFromLibrary({ name: "firecrawl", confirm: false, paths }), /confirm=true/);

    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });
    const installed = await readFile(resolve(paths.appDir, "skills", "firecrawl", "SKILL.md"), "utf8");
    assert.match(installed, /# firecrawl/);
    const manifest = JSON.parse(await readFile(resolve(paths.appDir, "skills", "firecrawl", "bestie-skill.json"), "utf8"));
    assert.equal(manifest.source, "remote");
    assert.equal(manifest.libraryVersion, "1.0.0");
    assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
    const item = await getUiSkill("firecrawl", paths);
    assert.equal(item.manifest?.sourceId, "bestie-official-github");
    assert.equal(item.manifest?.libraryVersion, "1.0.0");

    const library = await getUiSkillLibrary(paths);
    const dailyPlanner = library.skills.find((skill) => skill.name === "firecrawl");
    assert.equal(dailyPlanner?.installed, true);
    assert.equal(dailyPlanner?.installedVersion, "1.0.0");
    assert.equal(dailyPlanner?.updateAvailable, false);
    assert.equal(dailyPlanner?.localChanges, false);
    assert.equal(dailyPlanner?.rollbackAvailable, false);
    assert.ok((dailyPlanner?.installedBytes ?? 0) > 0);

    const summary = await getUiSkillsSummary(paths);
    const installedSummary = summary.skills.find((skill) => skill.name === "firecrawl");
    assert.match(installedSummary?.currentHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(installedSummary?.localChanges, false);
    assert.equal(installedSummary?.rollbackAvailable, false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("installUiSkillFromLibrary installs every verified remote bundle file", async () => {
  const paths = await createTempPaths();
  const skillContent = "# Bundle Skill\n\nUse the helper.\n";
  const helperContent = "#!/usr/bin/env bash\necho helper\n";
  const files = [
    { path: "SKILL.md", hash: `sha256:${hashContent(skillContent.replace(/\n/g, "\r\n"))}`, contentUrl: "https://skills.example.test/bundle/SKILL.md" },
    { path: "scripts/helper.sh", hash: `sha256:${hashContent(helperContent)}`, contentUrl: "https://skills.example.test/bundle/scripts/helper.sh" },
  ];
  const registry = createRemoteRegistryDocument({ files });
  const payload = JSON.stringify(registry);
  const keys = createTestKeys();
  const signature = signPayload(payload, keys.privateKey);

  try {
    await writeConfigWithRemoteRegistry(paths, { enabled: true, url: "https://skills.example.test/registry.json", publicKey: keys.publicKey, signatureHeader: "x-bestie-signature", installPolicy: "ask" });
    await testUiSkillRemoteRegistry({ confirm: true, paths, fetchImpl: async () => new Response(payload, { headers: { "x-bestie-signature": signature } }) });
    await installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths, fetchImpl: async (url) => new Response(String(url).endsWith("helper.sh") ? helperContent : skillContent) });

    assert.equal(await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "SKILL.md"), "utf8"), skillContent);
    assert.equal(await readFile(resolve(paths.appDir, "skills", "remote-test-skill", "scripts", "helper.sh"), "utf8"), helperContent);

    await assert.rejects(() => installUiSkillFromLibrary({ name: "remote-test-skill", sourceId: "remote-official-test", confirm: true, paths, fetchImpl: async () => new Response("tampered") }), /hash verification failed/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("toggleUiSkillEnabled requires confirmation and keeps disabled skills visible", async () => {
  const paths = await createTempPaths();

  try {
    await installUiSkillFromLibrary({ name: "self-improvement", confirm: true, paths });
    await assert.rejects(() => toggleUiSkillEnabled({ name: "self-improvement", enabled: false, confirm: false, paths }), /confirm=true/);

    const disabledSummary = await toggleUiSkillEnabled({ name: "self-improvement", enabled: false, confirm: true, paths });
    const disabled = disabledSummary.skills.find((skill) => skill.name === "self-improvement");
    assert.equal(disabled?.enabled, false);
    assert.equal(disabled?.manifest?.enabled, false);
    assert.deepEqual(disabled?.manifest?.permissions, ["local_read", "local_write"]);

    const library = await getUiSkillLibrary(paths);
    const librarySkill = library.skills.find((skill) => skill.name === "self-improvement");
    assert.equal(librarySkill?.installed, true);
    assert.equal(librarySkill?.enabled, false);

    const enabledSummary = await toggleUiSkillEnabled({ name: "self-improvement", enabled: true, confirm: true, paths });
    const enabled = enabledSummary.skills.find((skill) => skill.name === "self-improvement");
    assert.equal(enabled?.enabled, true);
    assert.equal(enabled?.manifest?.enabled, true);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("skill write and delete reject reserved internal archive names", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(() => writeUiSkill({ name: ".uninstalled", content: "# Hidden\n", paths }), /Skill name is required/);
    await assert.rejects(() => deleteUiSkill({ name: ".uninstalled", paths }), /Skill name is required/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("writeUiSkill updates local manifest hashes without marking local edits dirty", async () => {
  const paths = await createTempPaths();

  try {
    await writeUiSkill({ name: "local-helper", content: "# Local Helper\n\nInitial local skill.\n", paths });
    await toggleUiSkillEnabled({ name: "local-helper", enabled: false, confirm: true, paths });

    const edited = await writeUiSkill({ name: "local-helper", content: "# Local Helper\n\nEdited local skill.\n", paths });
    const localSkill = edited.skills.find((skill) => skill.name === "local-helper");
    assert.equal(localSkill?.enabled, false);
    assert.equal(localSkill?.manifest?.source, "local");
    assert.equal(localSkill?.manifest?.enabled, false);
    assert.equal(localSkill?.localChanges, false);
    assert.equal(localSkill?.manifest?.contentHash, localSkill?.currentHash);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("writeUiSkill preserves manifest enablement across edit and rename", async () => {
  const paths = await createTempPaths();

  try {
    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });
    await toggleUiSkillEnabled({ name: "firecrawl", enabled: false, confirm: true, paths });

    const edited = await writeUiSkill({ name: "firecrawl", content: "# firecrawl\n\nEdited while disabled.\n", paths });
    const editedSkill = edited.skills.find((skill) => skill.name === "firecrawl");
    assert.equal(editedSkill?.enabled, false);
    assert.equal(editedSkill?.manifest?.enabled, false);
    assert.equal(editedSkill?.manifest?.sourceId, "bestie-official-github");
    assert.equal(editedSkill?.localChanges, true);

    const renamed = await writeUiSkill({ name: "renamed-planner", previousName: "firecrawl", content: "# Renamed Planner\n\nStill disabled.\n", paths });
    assert.equal(renamed.skills.some((skill) => skill.name === "firecrawl"), false);
    const renamedSkill = renamed.skills.find((skill) => skill.name === "renamed-planner");
    assert.equal(renamedSkill?.enabled, false);
    assert.equal(renamedSkill?.manifest?.enabled, false);
    assert.equal(renamedSkill?.manifest?.name, "renamed-planner");
    assert.equal(renamedSkill?.manifest?.sourceId, "bestie-official-github");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("getUiSkillLibraryDiff detects local changes before update", async () => {
  const paths = await createTempPaths();

  try {
    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });
    await writeFile(resolve(paths.appDir, "skills", "firecrawl", "SKILL.md"), "# firecrawl\n\nLocal owner edit.\n");

    const summary = await getUiSkillsSummary(paths);
    const installedSummary = summary.skills.find((skill) => skill.name === "firecrawl");
    assert.equal(installedSummary?.localChanges, true);

    const diff = await getUiSkillLibraryDiff("firecrawl", paths);
    assert.equal(diff.ok, true);
    assert.equal(diff.installed, true);
    assert.equal(diff.updateAvailable, true);
    assert.equal(diff.localChanges, true);
    assert.ok(diff.addedLines > 0);
    assert.ok(diff.removedLines > 0);
    assert.equal(diff.rollbackAvailable, false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("deleteUiSkill archives removed skill content and manifest", async () => {
  const paths = await createTempPaths();

  try {
    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });
    await toggleUiSkillEnabled({ name: "firecrawl", enabled: false, confirm: true, paths });
    const deleted = await deleteUiSkill({ name: "firecrawl", paths });
    assert.equal(deleted.skills.some((skill) => skill.name === "firecrawl"), false);

    const archiveRoot = resolve(paths.appDir, "skills", ".uninstalled");
    const archiveNames = await readdir(archiveRoot);
    const dailyPlannerArchive = archiveNames.find((name) => name.startsWith("firecrawl-"));
    assert.ok(dailyPlannerArchive);
    const archivedContent = await readFile(resolve(archiveRoot, dailyPlannerArchive, "SKILL.md"), "utf8");
    assert.match(archivedContent, /# firecrawl/);
    const archivedManifest = JSON.parse(await readFile(resolve(archiveRoot, dailyPlannerArchive, "bestie-skill.json"), "utf8"));
    assert.equal(archivedManifest.name, "firecrawl");
    assert.equal(archivedManifest.enabled, false);
    assert.equal(archivedManifest.sourceId, "bestie-official-github");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("rollbackUiSkill restores the latest backup after reinstall", async () => {
  const paths = await createTempPaths();

  try {
    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });
    await writeFile(resolve(paths.appDir, "skills", "firecrawl", "SKILL.md"), "# firecrawl\n\nLocal owner edit.\n");
    await installUiSkillFromLibrary({ name: "firecrawl", confirm: true, paths });

    const diff = await getUiSkillLibraryDiff("firecrawl", paths);
    assert.equal(diff.rollbackAvailable, true);
    const library = await getUiSkillLibrary(paths);
    assert.equal(library.skills.find((skill) => skill.name === "firecrawl")?.rollbackAvailable, true);

    await assert.rejects(() => rollbackUiSkill({ name: "firecrawl", confirm: false, paths }), /confirm=true/);
    await rollbackUiSkill({ name: "firecrawl", confirm: true, paths });

    const restored = await readFile(resolve(paths.appDir, "skills", "firecrawl", "SKILL.md"), "utf8");
    assert.match(restored, /Local owner edit/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("getUiSkillLibraryItem returns source preview content", async () => {
  const paths = await createTempPaths();

  try {
    const result = await getUiSkillLibraryItem("self-improvement", paths);
    assert.equal(result.ok, true);
    assert.equal(result.skill.name, "self-improvement");
    assert.equal(result.skill.risk, "medium");
    assert.equal(result.skill.sourceName, "Bestie Official Skill Library");
    assert.equal(result.skill.verificationMethod, "sha256-sidecar");
    assert.match(result.content, /# Self-Improvement Skill/);
    assert.match(result.content, /durable learning files/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-skills-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  const paths = {
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
  await seedDefaultSkillRegistry(paths);
  return paths;
}

async function seedDefaultSkillRegistry(paths: RuntimePaths): Promise<void> {
  const skills: CuratedSkillTemplate[] = [
    { name: "facebook-manager", title: "Facebook Manager", description: "Manage Facebook Pages through Composio MCP.", category: "channels", version: "1.0.0", author: "Bestie", trust: "official", risk: "high", permissions: ["network", "external_action"], changelog: "Initial test registry skill.", content: "# facebook-manager\n\nManage Facebook Pages through Composio MCP.\n" },
    { name: "firecrawl", title: "Firecrawl Research", description: "Use Firecrawl for public web research and extraction.", category: "research", version: "1.0.0", author: "Bestie", trust: "official", risk: "medium", permissions: ["network"], changelog: "Initial test registry skill.", content: "# firecrawl\n\nUse Firecrawl for public web research and extraction.\n" },
    { name: "gmail-manager", title: "Gmail Manager", description: "Manage Gmail through Composio MCP.", category: "workflows", version: "1.0.0", author: "Bestie", trust: "official", risk: "high", permissions: ["network", "external_action"], changelog: "Initial test registry skill.", content: "# gmail-manager\n\nManage Gmail through Composio MCP.\n" },
    { name: "kling-cli", title: "Kling CLI", description: "Use Kling CLI for image and video generation.", category: "media", version: "1.0.0", author: "Bestie", trust: "official", risk: "medium", permissions: ["shell", "network", "local_write"], changelog: "Initial test registry skill.", content: "# Kling CLI Skill\n\nUse Kling CLI for image and video generation.\n" },
    { name: "self-improvement", title: "Self Improvement", description: "Capture durable corrections and lessons.", category: "memory", version: "1.0.0", author: "Bestie", trust: "official", risk: "medium", permissions: ["local_read", "local_write"], changelog: "Initial test registry skill.", content: "# Self-Improvement Skill\n\nThis skill turns corrections into durable learning files.\n" },
    { name: "youtube-manager", title: "YouTube Manager", description: "Manage YouTube through Composio MCP.", category: "channels", version: "1.0.0", author: "Bestie", trust: "official", risk: "high", permissions: ["network", "external_action"], changelog: "Initial test registry skill.", content: "# youtube-manager\n\nManage YouTube through Composio MCP.\n" },
  ];
  const registryHash = hashSkillRegistry(skills);
  await mkdir(paths.dataDir, { recursive: true });
  await writeFile(resolve(paths.dataDir, "skill-remote-registry-cache.json"), `${JSON.stringify({
    source: { id: "bestie-official-github", name: "Bestie Official Skill Library", kind: "remote", enabled: true, trust: "official", skillCount: skills.length, verification: { status: "verified", method: "sha256-sidecar", detail: "Remote registry checksum verified.", registryHash }, cache: { cachedAt: new Date().toISOString(), ageMs: 0, status: "fresh" } },
    skills,
    validation: { ok: true, count: skills.length, issues: [] },
    registryHash,
  }, null, 2)}\n`);
}

async function writeConfigWithRemoteRegistry(paths: RuntimePaths, remoteOfficial: { enabled: boolean; url: string; publicKey?: string; signatureHeader?: string; installPolicy?: "deny" | "ask" }): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await rm(resolve(paths.dataDir, "skill-remote-registry-cache.json"), { force: true });
  await writeFile(paths.configPath, `${JSON.stringify({
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_API_KEY" } },
      modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
    },
    skills: { registry: { remoteOfficial } },
  }, null, 2)}\n`);
}

function createRemoteRegistryDocument(overrides: Partial<CuratedSkillTemplate> = {}) {
  return {
    schemaVersion: 1,
    source: { id: "remote-official-test", name: "Remote Official Test", trust: "official" },
    skills: [{ name: "remote-test-skill", title: "Remote Test Skill", description: "Signed test skill.", category: "testing", version: "1.0.0", author: "Bestie", trust: "official", risk: "low", permissions: [], changelog: "Initial signed test.", content: "# Remote Test Skill\n\nUse only in tests.\n", ...overrides }],
  };
}

function createTestKeys(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

function signPayload(payload: string, privateKey: string): string {
  const signer = createSign("sha256");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}
