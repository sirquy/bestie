import { createHash, createVerify } from "node:crypto";
import { basename } from "node:path";

export type SkillTrustLevel = "official" | "verified" | "community" | "local";
export type SkillRiskLevel = "low" | "medium" | "high";
export type SkillRegistrySourceKind = "remote";
export type SkillRegistryVerificationStatus = "verified" | "unsigned" | "unavailable" | "failed";

export interface SkillDiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface SkillRegistryValidationIssue {
  name?: string;
  field: string;
  message: string;
}

export interface SkillRegistryValidationResult {
  ok: boolean;
  count: number;
  issues: SkillRegistryValidationIssue[];
}

export interface SkillRegistryVerification {
  status: SkillRegistryVerificationStatus;
  method: string;
  detail: string;
  registryHash?: string;
}

export interface SkillRegistryCacheMetadata {
  cachedAt: string;
  ageMs: number;
  status: "fresh" | "stale";
}

export interface SkillRegistrySource {
  id: string;
  name: string;
  kind: SkillRegistrySourceKind;
  enabled: boolean;
  trust: SkillTrustLevel;
  skillCount: number;
  verification: SkillRegistryVerification;
  cache?: SkillRegistryCacheMetadata;
}

export interface RemoteSkillRegistryConfig {
  enabled: boolean;
  url: string;
  checksumUrl?: string;
  publicKey?: string;
  signatureHeader?: string;
  timeoutMs?: number;
  installPolicy?: "deny" | "ask";
}

export interface SkillRegistrySnapshot {
  source: SkillRegistrySource;
  skills: CuratedSkillTemplate[];
  validation: SkillRegistryValidationResult;
  registryHash: string;
}

export interface RemoteSkillRegistryDocument {
  schemaVersion: 1;
  source: {
    id: string;
    name: string;
    trust: SkillTrustLevel;
  };
  skills: CuratedSkillTemplate[];
}

export interface RemoteSkillRegistryFetchOptions {
  config: RemoteSkillRegistryConfig;
  fetchImpl?: typeof fetch;
  signature?: string;
  checksum?: string;
}

export interface CuratedSkillTemplate {
  name: string;
  title: string;
  description: string;
  category: string;
  version: string;
  author: string;
  trust: SkillTrustLevel;
  risk: SkillRiskLevel;
  permissions: string[];
  changelog: string;
  content: string;
}

export const DEFAULT_REMOTE_SKILL_REGISTRY_CONFIG: RemoteSkillRegistryConfig = {
  enabled: true,
  url: "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.json",
  checksumUrl: "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.sha256",
  timeoutMs: 10_000,
  installPolicy: "ask",
};

export function getDefaultRemoteSkillRegistryConfig(): RemoteSkillRegistryConfig {
  return { ...DEFAULT_REMOTE_SKILL_REGISTRY_CONFIG };
}

export function createEmptySkillRegistrySnapshot(source: SkillRegistrySource): SkillRegistrySnapshot {
  return {
    source,
    skills: [],
    validation: { ok: true, count: 0, issues: [] },
    registryHash: hashSkillRegistry([]),
  };
}

export function listSkillRegistrySources(options: { remoteOfficial?: RemoteSkillRegistryConfig; cachedSource?: SkillRegistrySource } = {}): SkillRegistrySource[] {
  if (options.cachedSource) return [options.cachedSource];
  const remote = options.remoteOfficial ?? getDefaultRemoteSkillRegistryConfig();
  return [
    {
      id: "remote-official",
      name: "Bestie Official Skill Library",
      kind: "remote",
      enabled: remote.enabled === true,
      trust: "official",
      skillCount: 0,
      verification: remote.enabled === true
        ? remote.publicKey
          ? { status: "unsigned", method: "signature", detail: `Remote registry configured at ${remote.url}; fetch and signature verification have not run yet.` }
          : remote.checksumUrl
            ? { status: "unsigned", method: "sha256-sidecar", detail: `Remote registry configured at ${remote.url}; checksum verification has not run yet.` }
            : { status: "failed", method: "remote", detail: `Remote registry configured at ${remote.url} but no public key or checksum URL is configured.` }
        : { status: "unavailable", method: "remote", detail: "Remote skill registry is disabled." },
    },
  ];
}

export async function fetchRemoteSkillRegistrySnapshot(options: RemoteSkillRegistryFetchOptions): Promise<SkillRegistrySnapshot> {
  if (!options.config.enabled) {
    throw new Error("Remote skill registry is disabled.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.config.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(options.config.url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Remote skill registry returned HTTP ${response.status}.`);
    const signature = options.signature ?? (options.config.signatureHeader ? response.headers.get(options.config.signatureHeader) ?? undefined : undefined);
    const payload = await response.text();
    const checksum = options.checksum ?? await fetchRemoteChecksum(fetchImpl, options.config, controller.signal);
    return parseRemoteSkillRegistryPayload(payload, { config: options.config, signature, checksum });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteChecksum(fetchImpl: typeof fetch, config: RemoteSkillRegistryConfig, signal: AbortSignal): Promise<string | undefined> {
  if (!config.checksumUrl) return undefined;
  const response = await fetchImpl(config.checksumUrl, { headers: { accept: "text/plain" }, signal });
  if (!response.ok) throw new Error(`Remote skill registry checksum returned HTTP ${response.status}.`);
  return response.text();
}

export function parseRemoteSkillRegistryPayload(payload: string, options: { config: RemoteSkillRegistryConfig; signature?: string; checksum?: string }): SkillRegistrySnapshot {
  const parsed = JSON.parse(payload) as unknown;
  const document = parseRemoteSkillRegistryDocument(parsed);
  const validation = validateRemoteSkillRegistry(validateCuratedSkillRegistry(document.skills), document);
  const registryHash = hashSkillRegistry(document.skills);
  const verification = verifyRemoteRegistryPayload(payload, options.config, options.signature, options.checksum, registryHash, validation.ok);

  return {
    source: {
      id: document.source.id,
      name: document.source.name,
      kind: "remote",
      enabled: options.config.enabled,
      trust: document.source.trust,
      skillCount: document.skills.length,
      verification,
    },
    skills: document.skills,
    validation,
    registryHash,
  };
}

function validateRemoteSkillRegistry(validation: SkillRegistryValidationResult, document: RemoteSkillRegistryDocument): SkillRegistryValidationResult {
  const issues = [...validation.issues];
  if (document.source.id === "remote-official") {
    issues.push({ field: "source.id", message: "Remote registry source id cannot use a reserved internal source id." });
  }
  return { ok: issues.length === 0, count: validation.count, issues };
}

export function verifyDetachedSignature(payload: string, signature: string, publicKey: string): boolean {
  try {
    const verifier = createVerify("sha256");
    verifier.update(payload, "utf8");
    verifier.end();
    return verifier.verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

export function validateCuratedSkillRegistry(skills: CuratedSkillTemplate[] = []): SkillRegistryValidationResult {
  const issues: SkillRegistryValidationIssue[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const normalizedName = normalizeSkillName(skill.name);
    if (!skill.name || normalizedName !== skill.name) issues.push({ name: skill.name, field: "name", message: "Skill name must already be normalized." });
    if (seen.has(skill.name)) issues.push({ name: skill.name, field: "name", message: "Skill name must be unique." });
    seen.add(skill.name);
    if (!skill.title.trim()) issues.push({ name: skill.name, field: "title", message: "Title is required." });
    if (!skill.description.trim()) issues.push({ name: skill.name, field: "description", message: "Description is required." });
    if (!skill.category.trim()) issues.push({ name: skill.name, field: "category", message: "Category is required." });
    if (!/^\d+\.\d+\.\d+$/.test(skill.version)) issues.push({ name: skill.name, field: "version", message: "Version must be semver-like x.y.z." });
    if (!skill.author.trim()) issues.push({ name: skill.name, field: "author", message: "Author is required." });
    if (!["official", "verified", "community", "local"].includes(skill.trust)) issues.push({ name: skill.name, field: "trust", message: "Trust level is invalid." });
    if (!["low", "medium", "high"].includes(skill.risk)) issues.push({ name: skill.name, field: "risk", message: "Risk level is invalid." });
    if (!Array.isArray(skill.permissions)) issues.push({ name: skill.name, field: "permissions", message: "Permissions must be an array." });
    if (!skill.changelog.trim()) issues.push({ name: skill.name, field: "changelog", message: "Changelog is required." });
    if (!skill.content.trim().startsWith("# ")) issues.push({ name: skill.name, field: "content", message: "Content must start with a Markdown title." });
    if (hashSkillContent(skill.content).length !== 64) issues.push({ name: skill.name, field: "contentHash", message: "Content hash must be sha256." });
  }
  return { ok: issues.length === 0, count: skills.length, issues };
}

export function hashSkillRegistry(skills: CuratedSkillTemplate[] = []): string {
  return hashContent(JSON.stringify(skills.map((skill) => ({
    name: skill.name,
    title: skill.title,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    author: skill.author,
    trust: skill.trust,
    risk: skill.risk,
    permissions: [...skill.permissions].sort(),
    changelog: skill.changelog,
    contentHash: hashSkillContent(skill.content),
  }))));
}

function parseRemoteSkillRegistryDocument(value: unknown): RemoteSkillRegistryDocument {
  if (!isRecord(value)) throw new Error("Remote skill registry must be an object.");
  if (value.schemaVersion !== 1) throw new Error("Remote skill registry schemaVersion must be 1.");
  const source = requireRecord(value.source, "source");
  const sourceTrust = requireTrustLevel(source.trust, "source.trust");
  if (!Array.isArray(value.skills)) throw new Error("Remote skill registry skills must be an array.");
  return {
    schemaVersion: 1,
    source: {
      id: requireNormalizedName(source.id, "source.id"),
      name: requireString(source.name, "source.name"),
      trust: sourceTrust,
    },
    skills: value.skills.map((skill, index) => parseRemoteSkillTemplate(skill, `skills[${index}]`)),
  };
}

function parseRemoteSkillTemplate(value: unknown, fieldName: string): CuratedSkillTemplate {
  const skill = requireRecord(value, fieldName);
  return {
    name: requireNormalizedName(skill.name, `${fieldName}.name`),
    title: requireString(skill.title, `${fieldName}.title`),
    description: requireString(skill.description, `${fieldName}.description`),
    category: requireString(skill.category, `${fieldName}.category`),
    version: requireString(skill.version, `${fieldName}.version`),
    author: requireString(skill.author, `${fieldName}.author`),
    trust: requireTrustLevel(skill.trust, `${fieldName}.trust`),
    risk: requireRiskLevel(skill.risk, `${fieldName}.risk`),
    permissions: requireStringArray(skill.permissions, `${fieldName}.permissions`),
    changelog: requireString(skill.changelog, `${fieldName}.changelog`),
    content: requireString(skill.content, `${fieldName}.content`),
  };
}

function verifyRemoteRegistryPayload(payload: string, config: RemoteSkillRegistryConfig, signature: string | undefined, checksum: string | undefined, registryHash: string, validationOk: boolean): SkillRegistryVerification {
  if (!validationOk) return { status: "failed", method: "remote", detail: "Remote registry failed schema validation.", registryHash };
  if (config.publicKey) {
    if (!signature) return { status: "unsigned", method: "signature", detail: "Remote registry did not include a detached signature.", registryHash };
    return verifyDetachedSignature(payload, signature, config.publicKey)
      ? { status: "verified", method: "signature", detail: "Remote registry signature verified.", registryHash }
      : { status: "failed", method: "signature", detail: "Remote registry signature verification failed.", registryHash };
  }
  if (config.checksumUrl) {
    if (!checksum) return { status: "unsigned", method: "sha256-sidecar", detail: "Remote registry checksum was not available.", registryHash };
    return verifyRegistryChecksum(payload, checksum)
      ? { status: "verified", method: "sha256-sidecar", detail: "Remote registry checksum verified.", registryHash }
      : { status: "failed", method: "sha256-sidecar", detail: "Remote registry checksum verification failed.", registryHash };
  }
  return { status: "failed", method: "remote", detail: "Remote registry requires a public key or checksum URL.", registryHash };
}

function verifyRegistryChecksum(payload: string, checksum: string): boolean {
  const expected = checksum.trim().split(/\s+/)[0]?.replace(/^sha256:/, "");
  return Boolean(expected && expected === hashContent(payload));
}

function requireNormalizedName(value: unknown, fieldName: string): string {
  const normalized = requireString(value, fieldName);
  if (normalizeSkillName(normalized) !== normalized) throw new Error(`${fieldName} must be normalized.`);
  return normalized;
}

function requireTrustLevel(value: unknown, fieldName: string): SkillTrustLevel {
  if (value !== "official" && value !== "verified" && value !== "community" && value !== "local") throw new Error(`${fieldName} is invalid.`);
  return value;
}

function requireRiskLevel(value: unknown, fieldName: string): SkillRiskLevel {
  if (value !== "low" && value !== "medium" && value !== "high") throw new Error(`${fieldName} is invalid.`);
  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) throw new Error(`${fieldName} must be an array of non-empty strings.`);
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${fieldName} must be a non-empty string.`);
  return value;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${fieldName} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashSkillContent(content: string): string {
  return hashContent(content.trim());
}

export function buildSkillDiff(current: string, proposed: string): SkillDiffLine[] {
  const currentLines = current.split(/\r?\n/);
  const proposedLines = proposed.split(/\r?\n/);
  const rows: SkillDiffLine[] = [];
  const max = Math.max(currentLines.length, proposedLines.length);
  for (let index = 0; index < max; index += 1) {
    const left = currentLines[index];
    const right = proposedLines[index];
    if (left === right && left !== undefined) rows.push({ kind: "same", text: left });
    else {
      if (left !== undefined) rows.push({ kind: "removed", text: left });
      if (right !== undefined) rows.push({ kind: "added", text: right });
    }
  }
  return rows;
}

function normalizeSkillName(name: string): string {
  const cleaned = basename(name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  if (cleaned === "." || cleaned === ".." || cleaned.startsWith(".")) return "";
  return cleaned;
}
