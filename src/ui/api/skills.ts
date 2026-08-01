import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { buildSkillDiff, createBundledSkillRegistrySnapshot, fetchRemoteSkillRegistrySnapshot, getCuratedSkillTemplateOrThrow, hashSkillContent, hashSkillRegistry, listSkillRegistrySources, validateCuratedSkillRegistry, type CuratedSkillTemplate, type RemoteSkillRegistryConfig, type SkillDiffLine, type SkillRegistryCacheMetadata, type SkillRegistrySnapshot, type SkillRegistrySource, type SkillRegistryValidationResult, type SkillRegistryVerificationStatus } from "../../skills/library.js";
import { loadInstalledSkills } from "../../skills/loader.js";
import { configExists, loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

const REMOTE_SKILL_REGISTRY_CACHE_STALE_MS = 24 * 60 * 60 * 1000;

export interface UiSkillsSummary {
  ok: true;
  count: number;
  skillsDir: string;
  skills: UiSkill[];
}

export interface UiSkill {
  name: string;
  path: string;
  bytes: number;
  preview: string;
  currentHash: string;
  localChanges: boolean;
  rollbackAvailable: boolean;
  enabled: boolean;
  manifest?: UiInstalledSkillManifest;
}

export interface UiSkillLibrarySummary {
  ok: true;
  count: number;
  installedCount: number;
  registry: UiSkillRegistrySummary;
  skills: UiSkillLibraryItem[];
}

export interface UiSkillRegistrySummary {
  activeSource: SkillRegistrySource;
  sources: SkillRegistrySource[];
  validation: SkillRegistryValidationResult;
  registryHash: string;
}

export interface UiSkillLibraryItem {
  name: string;
  title: string;
  description: string;
  category: string;
  version: string;
  author: string;
  trust: "official" | "verified" | "community" | "local";
  risk: "low" | "medium" | "high";
  permissions: string[];
  changelog: string;
  preview: string;
  installed: boolean;
  enabled: boolean;
  rollbackAvailable: boolean;
  installedBytes?: number;
  contentHash: string;
  installedHash?: string;
  installedVersion?: string;
  updateAvailable: boolean;
  localChanges: boolean;
  manifestPath?: string;
  sourceId: string;
  sourceName: string;
  readOnly: boolean;
  installable: boolean;
  installBlockedReason?: string;
  verificationStatus: SkillRegistryVerificationStatus;
  verificationMethod: string;
  cache?: SkillRegistryCacheMetadata;
}

export interface UiInstalledSkillManifest {
  schemaVersion: 1;
  name: string;
  source: "library" | "remote" | "local";
  sourceId?: string;
  sourceName?: string;
  libraryVersion?: string;
  installedAt: string;
  updatedAt: string;
  contentHash: string;
  previousContentHash?: string;
  enabled?: boolean;
  permissions?: string[];
}

export interface UiSkillLibraryDiff {
  ok: true;
  name: string;
  title: string;
  installed: boolean;
  updateAvailable: boolean;
  localChanges: boolean;
  currentHash?: string;
  proposedHash: string;
  currentBytes: number;
  proposedBytes: number;
  addedLines: number;
  removedLines: number;
  preview: UiSkillDiffLine[];
  rollbackAvailable: boolean;
  manifest?: UiInstalledSkillManifest;
}

export type UiSkillDiffLine = SkillDiffLine;

export interface UiSkillWriteOptions {
  name: string;
  content: string;
  previousName?: string;
  paths?: RuntimePaths;
}

export interface UiSkillDeleteOptions {
  name: string;
  paths?: RuntimePaths;
}

export interface UiSkillInstallOptions {
  name: string;
  confirm: boolean;
  sourceId?: string;
  paths?: RuntimePaths;
}

export interface UiSkillRollbackOptions {
  name: string;
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiSkillToggleOptions {
  name: string;
  enabled: boolean;
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiSkillRemoteRegistryTestOptions {
  confirm: boolean;
  paths?: RuntimePaths;
  fetchImpl?: typeof fetch;
}

export interface UiSkillRemoteRegistryClearOptions {
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiSkillRemoteRegistryTestResult {
  ok: true;
  configured: boolean;
  enabled: boolean;
  source?: SkillRegistrySource;
  validation?: SkillRegistryValidationResult;
  registryHash?: string;
  error?: string;
}

export async function getUiSkillsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiSkillsSummary> {
  const skills = await loadInstalledSkills(paths, { maxBytes: Number.MAX_SAFE_INTEGER, includeDisabled: true });
  return {
    ok: true,
    count: skills.length,
    skillsDir: resolve(paths.appDir, "skills"),
    skills: await Promise.all(skills.map(async (skill) => {
      const manifest = await readSkillManifest(paths, skill.name);
      const currentHash = hashSkillContent(skill.content);
      return {
        name: skill.name,
        path: skill.path,
        bytes: Buffer.byteLength(skill.content, "utf8"),
        preview: skill.content.slice(0, 220),
        currentHash,
        localChanges: Boolean(manifest && manifest.contentHash !== currentHash),
        rollbackAvailable: (await listSkillBackups(paths, skill.name)).length > 0,
        enabled: skill.enabled,
        manifest,
      };
    })),
  };
}

export async function getUiSkillLibrary(paths: RuntimePaths = getRuntimePaths()): Promise<UiSkillLibrarySummary> {
  const installed = await loadInstalledSkills(paths, { maxBytes: Number.MAX_SAFE_INTEGER, includeDisabled: true });
  const installedByName = new Map(installed.map((skill) => [skill.name, skill]));
  const snapshot = createBundledSkillRegistrySnapshot();
  const remoteOfficial = await getConfiguredRemoteRegistry(paths);
  const remoteSnapshot = await readCachedRemoteRegistrySnapshot(paths);
  const bundledSkills = await Promise.all(snapshot.skills.map(async (skill) => toLibraryItem(skill, snapshot.source, installedByName.get(skill.name), await readSkillManifest(paths, skill.name), paths)));
  const remoteSkills = remoteSnapshot
    ? await Promise.all(remoteSnapshot.skills.filter((skill) => !snapshot.skills.some((bundled) => bundled.name === skill.name)).map(async (skill) => toLibraryItem(skill, remoteSnapshot.source, installedByName.get(skill.name), await readSkillManifest(paths, skill.name), paths, remoteOfficial?.enabled === true && remoteOfficial.installPolicy === "ask")))
    : [];
  const skills = [...bundledSkills, ...remoteSkills];
  return { ok: true, count: skills.length, installedCount: skills.filter((skill) => skill.installed).length, registry: { activeSource: snapshot.source, sources: mergeRegistrySources(listSkillRegistrySources({ remoteOfficial }), remoteSnapshot?.source), validation: snapshot.validation, registryHash: snapshot.registryHash }, skills };
}

export async function getUiSkillLibraryItem(name: string, paths: RuntimePaths = getRuntimePaths(), sourceId = "bundled-official"): Promise<{ ok: true; skill: UiSkillLibraryItem; content: string }> {
  const { skill, source } = await resolveSkillForLibraryRead(paths, name, sourceId);
  const installed = (await loadInstalledSkills(paths, { maxBytes: Number.MAX_SAFE_INTEGER, includeDisabled: true })).find((item) => item.name === skill.name);
  return { ok: true, skill: await toLibraryItem(skill, source, installed, await readSkillManifest(paths, skill.name), paths), content: skill.content };
}

export async function getUiSkillLibraryDiff(name: string, paths: RuntimePaths = getRuntimePaths(), sourceId?: string): Promise<UiSkillLibraryDiff> {
  const manifest = await readSkillManifest(paths, name);
  const resolvedSourceId = sourceId ?? manifest?.sourceId ?? "bundled-official";
  const { skill } = await resolveSkillForLibraryRead(paths, name, resolvedSourceId);
  const current = await readSkillContentIfExists(paths, skill.name);
  const diff = buildSkillDiff(current ?? "", skill.content);
  const currentHash = current === undefined ? undefined : hashSkillContent(current);
  const proposedHash = hashSkillContent(skill.content);
  return {
    ok: true,
    name: skill.name,
    title: skill.title,
    installed: current !== undefined,
    updateAvailable: currentHash !== undefined && currentHash !== proposedHash,
    localChanges: Boolean(manifest && currentHash && manifest.contentHash !== currentHash),
    currentHash,
    proposedHash,
    currentBytes: current ? Buffer.byteLength(current, "utf8") : 0,
    proposedBytes: Buffer.byteLength(skill.content, "utf8"),
    addedLines: diff.filter((line) => line.kind === "added").length,
    removedLines: diff.filter((line) => line.kind === "removed").length,
    preview: diff.slice(0, 120),
    rollbackAvailable: (await listSkillBackups(paths, skill.name)).length > 0,
    manifest,
  };
}

export async function installUiSkillFromLibrary(options: UiSkillInstallOptions): Promise<UiSkillsSummary> {
  if (options.confirm !== true) throw new Error("Skill install requires confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  const { skill, source, remote } = await resolveSkillInstallSource(paths, options.name, options.sourceId ?? "bundled-official");
  if (remote) {
    const remoteOfficial = await getConfiguredRemoteRegistry(paths);
    if (remoteOfficial?.enabled !== true || remoteOfficial.installPolicy !== "ask") throw new Error("Remote skill install is disabled by policy.");
    if (source.verification.status !== "verified") throw new Error("Remote skill install requires a verified registry signature.");
  }
  const previousContent = await readSkillContentIfExists(paths, skill.name);
  if (previousContent !== undefined) await backupSkill(paths, skill.name);
  const previousManifest = await readSkillManifest(paths, skill.name);
  await writeUiSkill({ name: skill.name, content: skill.content, paths });
  await writeSkillManifest(paths, skill.name, {
    schemaVersion: 1,
    name: skill.name,
    source: remote ? "remote" : "library",
    sourceId: source.id,
    sourceName: source.name,
    libraryVersion: skill.version,
    installedAt: previousManifest?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashSkillContent(skill.content),
    previousContentHash: previousContent === undefined ? undefined : hashSkillContent(previousContent),
    enabled: previousManifest?.enabled ?? true,
    permissions: skill.permissions,
  });
  return getUiSkillsSummary(paths);
}

export async function rollbackUiSkill(options: UiSkillRollbackOptions): Promise<UiSkillsSummary> {
  if (options.confirm !== true) throw new Error("Skill rollback requires confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  const backups = await listSkillBackups(paths, skillName);
  const latest = backups.at(-1);
  if (!latest) throw new Error("No skill backup is available for rollback.");
  await mkdir(resolve(paths.appDir, "skills", skillName), { recursive: true, mode: 0o700 });
  await copyFile(latest, resolveSkillPath(paths, skillName));
  const content = await readFile(latest, "utf8");
  const previousManifest = await readSkillManifest(paths, skillName);
  await writeSkillManifest(paths, skillName, {
    schemaVersion: 1,
    name: skillName,
    source: previousManifest?.source ?? "local",
    sourceId: previousManifest?.sourceId,
    sourceName: previousManifest?.sourceName,
    libraryVersion: previousManifest?.libraryVersion,
    installedAt: previousManifest?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hashSkillContent(content),
    previousContentHash: previousManifest?.contentHash,
    enabled: previousManifest?.enabled ?? true,
    permissions: previousManifest?.permissions,
  });
  return getUiSkillsSummary(paths);
}

export async function toggleUiSkillEnabled(options: UiSkillToggleOptions): Promise<UiSkillsSummary> {
  if (options.confirm !== true) throw new Error("Skill enablement changes require confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  const current = await readSkillContentIfExists(paths, skillName);
  if (current === undefined) throw new Error("Skill is not installed.");
  const currentHash = hashSkillContent(current);
  const previousManifest = await readSkillManifest(paths, skillName);
  const source = previousManifest?.source ?? "local";
  await writeSkillManifest(paths, skillName, {
    schemaVersion: 1,
    name: skillName,
    source,
    sourceId: previousManifest?.sourceId,
    sourceName: previousManifest?.sourceName,
    libraryVersion: previousManifest?.libraryVersion,
    installedAt: previousManifest?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: source === "local" ? currentHash : previousManifest?.contentHash ?? currentHash,
    previousContentHash: previousManifest?.previousContentHash,
    enabled: options.enabled,
    permissions: previousManifest?.permissions,
  });
  return getUiSkillsSummary(paths);
}

export async function testUiSkillRemoteRegistry(options: UiSkillRemoteRegistryTestOptions): Promise<UiSkillRemoteRegistryTestResult> {
  if (options.confirm !== true) throw new Error("Remote skill registry test requires confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  const remoteOfficial = await getConfiguredRemoteRegistry(paths);
  if (!remoteOfficial) return { ok: true, configured: false, enabled: false };
  if (!remoteOfficial.enabled) return { ok: true, configured: true, enabled: false, source: listSkillRegistrySources({ remoteOfficial }).find((source) => source.id === "remote-official") };

  try {
    const snapshot = await fetchRemoteSkillRegistrySnapshot({ config: remoteOfficial, fetchImpl: options.fetchImpl });
    if (snapshot.source.verification.status === "verified") await writeCachedRemoteRegistrySnapshot(paths, snapshot);
    return { ok: true, configured: true, enabled: true, source: snapshot.source, validation: snapshot.validation, registryHash: snapshot.registryHash };
  } catch (error) {
    return { ok: true, configured: true, enabled: true, source: listSkillRegistrySources({ remoteOfficial }).find((source) => source.id === "remote-official"), error: error instanceof Error ? error.message : "Remote registry test failed." };
  }
}

export async function clearUiSkillRemoteRegistryCache(options: UiSkillRemoteRegistryClearOptions): Promise<UiSkillLibrarySummary> {
  if (options.confirm !== true) throw new Error("Remote skill registry cache clear requires confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  await rm(resolve(paths.dataDir, "skill-remote-registry-cache.json"), { force: true });
  return getUiSkillLibrary(paths);
}

export async function getUiSkill(name: string, paths: RuntimePaths = getRuntimePaths()): Promise<{ ok: true; name: string; path: string; content: string; manifest?: UiInstalledSkillManifest }> {
  const skillPath = resolveSkillPath(paths, name);
  const skillName = normalizeSkillName(name);
  return { ok: true, name: skillName, path: skillPath, content: await readFile(skillPath, "utf8"), manifest: await readSkillManifest(paths, skillName) };
}

export async function writeUiSkill(options: UiSkillWriteOptions): Promise<UiSkillsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  if (!options.content.trim()) throw new Error("Skill content is required.");

  const previousName = options.previousName ? normalizeSkillName(options.previousName) : "";
  const existingManifest = await readSkillManifest(paths, previousName || skillName);
  const skillDir = resolve(paths.appDir, "skills", skillName);
  const content = options.content.endsWith("\n") ? options.content : `${options.content}\n`;
  await mkdir(skillDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(skillDir, "SKILL.md"), content, { mode: 0o600 });
  if (existingManifest) {
    const nextHash = hashSkillContent(content);
    await writeSkillManifest(paths, skillName, {
      ...existingManifest,
      name: skillName,
      updatedAt: new Date().toISOString(),
      contentHash: existingManifest.source === "local" ? nextHash : existingManifest.contentHash,
      previousContentHash: existingManifest.source === "local" ? existingManifest.contentHash : existingManifest.previousContentHash,
    });
  }
  if (previousName && previousName !== skillName) await rm(resolve(paths.appDir, "skills", previousName), { recursive: true, force: true });
  return getUiSkillsSummary(paths);
}

export async function deleteUiSkill(options: UiSkillDeleteOptions): Promise<UiSkillsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  await archiveSkillBeforeDelete(paths, skillName);
  await rm(resolve(paths.appDir, "skills", skillName), { recursive: true, force: true });
  return getUiSkillsSummary(paths);
}

function resolveSkillPath(paths: RuntimePaths, name: string): string {
  return resolve(paths.appDir, "skills", normalizeSkillName(name), "SKILL.md");
}

function resolveSkillManifestPath(paths: RuntimePaths, name: string): string {
  return resolve(paths.appDir, "skills", normalizeSkillName(name), "bestie-skill.json");
}

function resolveSkillBackupDir(paths: RuntimePaths, name: string): string {
  return resolve(paths.appDir, "skills", normalizeSkillName(name), ".backups");
}

function normalizeSkillName(name: string): string {
  const cleaned = basename(name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  if (cleaned === "." || cleaned === ".." || cleaned.startsWith(".")) return "";
  return cleaned;
}

async function toLibraryItem(skill: CuratedSkillTemplate, source: SkillRegistrySource, installed?: { content: string; enabled: boolean }, manifest?: UiInstalledSkillManifest, paths?: RuntimePaths, remoteInstallEnabled = false): Promise<UiSkillLibraryItem> {
  const contentHash = hashSkillContent(skill.content);
  const installedHash = installed ? hashSkillContent(installed.content) : undefined;
  const installable = source.kind === "bundled" || (source.kind === "remote" && source.verification.status === "verified" && remoteInstallEnabled);
  const rollbackAvailable = Boolean(installed && paths && (await listSkillBackups(paths, skill.name)).length > 0);
  return {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    author: skill.author,
    trust: skill.trust,
    risk: skill.risk,
    permissions: skill.permissions,
    changelog: skill.changelog,
    preview: skill.content.slice(0, 220),
    installed: Boolean(installed),
    enabled: installed?.enabled ?? true,
    rollbackAvailable,
    installedBytes: installed ? Buffer.byteLength(installed.content, "utf8") : undefined,
    contentHash,
    installedHash,
    installedVersion: manifest?.libraryVersion,
    updateAvailable: Boolean(installedHash && installedHash !== contentHash),
    localChanges: Boolean(manifest && installedHash && manifest.contentHash !== installedHash),
    manifestPath: paths ? resolveSkillManifestPath(paths, skill.name) : undefined,
    sourceId: source.id,
    sourceName: source.name,
    readOnly: source.kind === "remote" && !installable,
    installable,
    installBlockedReason: installable ? undefined : source.kind === "remote" ? "Remote registry skills require an enabled verified registry and skills.registry.remoteOfficial.installPolicy=ask before install." : undefined,
    verificationStatus: source.verification.status,
    verificationMethod: source.verification.method,
    cache: source.cache,
  };
}

async function resolveSkillForLibraryRead(paths: RuntimePaths, name: string, sourceId: string): Promise<{ skill: CuratedSkillTemplate; source: SkillRegistrySource }> {
  if (sourceId === "bundled-official") return { skill: getCuratedSkillTemplateOrThrow(name), source: createBundledSkillRegistrySnapshot().source };
  const remoteSnapshot = await readCachedRemoteRegistrySnapshot(paths);
  const skillName = normalizeSkillName(name);
  const skill = remoteSnapshot?.source.id === sourceId ? remoteSnapshot.skills.find((item) => item.name === skillName) : undefined;
  if (!remoteSnapshot || !skill) throw new Error("Remote skill was not found in a verified registry cache.");
  return { skill, source: remoteSnapshot.source };
}

async function resolveSkillInstallSource(paths: RuntimePaths, name: string, sourceId: string): Promise<{ skill: CuratedSkillTemplate; source: SkillRegistrySource; remote: boolean }> {
  if (sourceId === "bundled-official") {
    return { skill: getCuratedSkillTemplateOrThrow(name), source: createBundledSkillRegistrySnapshot().source, remote: false };
  }

  const remoteSnapshot = await readCachedRemoteRegistrySnapshot(paths);
  const skillName = normalizeSkillName(name);
  const skill = remoteSnapshot?.source.id === sourceId ? remoteSnapshot.skills.find((item) => item.name === skillName) : undefined;
  if (!remoteSnapshot || !skill) throw new Error("Remote skill was not found in a verified registry cache.");
  return { skill, source: remoteSnapshot.source, remote: true };
}

async function readSkillContentIfExists(paths: RuntimePaths, name: string): Promise<string | undefined> {
  try {
    return await readFile(resolveSkillPath(paths, name), "utf8");
  } catch {
    return undefined;
  }
}

async function getConfiguredRemoteRegistry(paths: RuntimePaths): Promise<RemoteSkillRegistryConfig | undefined> {
  if (!(await configExists(paths))) return undefined;
  try {
    return (await loadConfig(paths)).skills?.registry?.remoteOfficial;
  } catch {
    return undefined;
  }
}

async function readCachedRemoteRegistrySnapshot(paths: RuntimePaths): Promise<SkillRegistrySnapshot | undefined> {
  try {
    const parsed = JSON.parse(await readFile(resolve(paths.dataDir, "skill-remote-registry-cache.json"), "utf8")) as SkillRegistrySnapshot;
    if (parsed.source?.verification?.status !== "verified" || !Array.isArray(parsed.skills) || typeof parsed.registryHash !== "string") return undefined;
    const validation = validateCuratedSkillRegistry(parsed.skills);
    if (!validation.ok) return undefined;
    const registryHash = hashSkillRegistry(parsed.skills);
    if (registryHash !== parsed.registryHash || parsed.source.verification.registryHash !== registryHash) return undefined;
    const cachedAt = typeof parsed.source.cache?.cachedAt === "string" ? parsed.source.cache.cachedAt : undefined;
    const source = { ...parsed.source, verification: { ...parsed.source.verification, registryHash } };
    if (!cachedAt) return { ...parsed, validation, registryHash, source };
    const ageMs = Math.max(0, Date.now() - Date.parse(cachedAt));
    return { ...parsed, validation, registryHash, source: { ...source, cache: { cachedAt, ageMs, status: ageMs > REMOTE_SKILL_REGISTRY_CACHE_STALE_MS ? "stale" : "fresh" } } };
  } catch {
    return undefined;
  }
}

async function writeCachedRemoteRegistrySnapshot(paths: RuntimePaths, snapshot: SkillRegistrySnapshot): Promise<void> {
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  const cachedAt = new Date().toISOString();
  const cachedSnapshot = { ...snapshot, source: { ...snapshot.source, cache: { cachedAt, ageMs: 0, status: "fresh" } } };
  await writeFile(resolve(paths.dataDir, "skill-remote-registry-cache.json"), `${JSON.stringify(cachedSnapshot, null, 2)}\n`, { mode: 0o600 });
}

function mergeRegistrySources(sources: SkillRegistrySource[], cachedRemote?: SkillRegistrySource): SkillRegistrySource[] {
  if (!cachedRemote) return sources;
  return sources.map((source) => source.id === "remote-official" ? { ...cachedRemote, id: "remote-official", enabled: true } : source);
}

async function readSkillManifest(paths: RuntimePaths, name: string): Promise<UiInstalledSkillManifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(resolveSkillManifestPath(paths, name), "utf8"));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.name !== "string" || typeof parsed.contentHash !== "string") return undefined;
    return parsed as UiInstalledSkillManifest;
  } catch {
    return undefined;
  }
}

async function writeSkillManifest(paths: RuntimePaths, name: string, manifest: UiInstalledSkillManifest): Promise<void> {
  await writeFile(resolveSkillManifestPath(paths, name), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

async function archiveSkillBeforeDelete(paths: RuntimePaths, name: string): Promise<void> {
  const skillName = normalizeSkillName(name);
  const content = await readSkillContentIfExists(paths, skillName);
  if (content === undefined) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = resolve(paths.appDir, "skills", ".uninstalled", `${skillName}-${timestamp}`);
  await mkdir(archiveDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(archiveDir, "SKILL.md"), content, { mode: 0o600 });
  const manifest = await readSkillManifest(paths, skillName);
  if (manifest) await writeFile(resolve(archiveDir, "bestie-skill.json"), `${JSON.stringify(manifest, null, 2)}
`, { mode: 0o600 });
}

async function backupSkill(paths: RuntimePaths, name: string): Promise<void> {
  const skillName = normalizeSkillName(name);
  const backupDir = resolveSkillBackupDir(paths, skillName);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(resolveSkillPath(paths, skillName), resolve(backupDir, `${timestamp}-SKILL.md`));
}

async function listSkillBackups(paths: RuntimePaths, name: string): Promise<string[]> {
  try {
    const backupDir = resolveSkillBackupDir(paths, name);
    const entries = await readdir(backupDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith("-SKILL.md")).map((entry) => resolve(backupDir, entry.name)).sort();
  } catch {
    return [];
  }
}
