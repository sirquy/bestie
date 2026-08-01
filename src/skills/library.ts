import { createHash, createVerify } from "node:crypto";
import { basename } from "node:path";

export type SkillTrustLevel = "official" | "verified" | "community" | "local";
export type SkillRiskLevel = "low" | "medium" | "high";
export type SkillRegistrySourceKind = "bundled" | "remote";
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

export const CURATED_SKILL_LIBRARY: CuratedSkillTemplate[] = [
  {
    name: "daily-planner",
    title: "Daily Planner",
    description: "Turns a messy day into a short, prioritized plan with follow-up checkpoints.",
    category: "productivity",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Daily Planner\n\nUse this skill when the user asks to plan today, organize tasks, choose priorities, or recover from overwhelm.\n\n## Behavior\n\n- Ask for deadlines, fixed appointments, energy level, and must-win outcome when they are missing.\n- Split work into at most 3 priority blocks, 2 maintenance blocks, and 1 recovery buffer.\n- Prefer concrete next actions over vague encouragement.\n- End with a tiny first step the user can do in 5 minutes.\n\n## Boundaries\n\n- Do not claim calendar access unless the user provides calendar details.\n- Do not schedule public, financial, destructive, or external actions without explicit approval.\n`,
  },
  {
    name: "meeting-brief",
    title: "Meeting Brief",
    description: "Creates compact agendas, talking points, decisions, and follow-up notes.",
    category: "workflows",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Meeting Brief\n\nUse this skill when the user prepares for a meeting, summarizes a meeting, or needs follow-up items.\n\n## Behavior\n\n- Identify purpose, attendees, decisions needed, risks, and open questions.\n- Produce a short agenda before the meeting or concise notes after it.\n- Separate facts, assumptions, decisions, and action items.\n- Assign owners only when the user names them.\n\n## Output\n\nUse bullets with sections: Goal, Context, Agenda or Notes, Decisions, Follow-ups.\n`,
  },
  {
    name: "code-review-buddy",
    title: "Code Review Buddy",
    description: "Reviews diffs for correctness, safety, tests, and maintainability without nitpicking style.",
    category: "coding",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "medium",
    permissions: ["local_read"],
    changelog: "Initial local curated template with read-only review expectations.",
    content: `# Code Review Buddy\n\nUse this skill when the user asks for a code review, PR review, or risk assessment of local changes.\n\n## Behavior\n\n- Prioritize bugs, security/privacy issues, data loss, broken tests, and contract mismatches.\n- Cite file paths and line numbers when available.\n- Keep style comments minimal unless they affect readability or correctness.\n- Suggest focused fixes, not broad rewrites.\n\n## Safety\n\n- Read-only review is preferred.\n- Ask before applying changes unless the user explicitly asks you to fix them.\n`,
  },
  {
    name: "debugging-coach",
    title: "Debugging Coach",
    description: "Builds a hypothesis-driven debugging loop for failing commands, tests, or runtime behavior.",
    category: "coding",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "medium",
    permissions: ["local_read", "local_action"],
    changelog: "Initial local curated template with conservative execution guidance.",
    content: `# Debugging Coach\n\nUse this skill when the user reports a bug, failing test, confusing error, or flaky behavior.\n\n## Behavior\n\n- Reproduce narrowly before changing code when possible.\n- State the current hypothesis and the evidence that would confirm or reject it.\n- Change one meaningful thing at a time.\n- Prefer targeted tests before broad suites.\n\n## Safety\n\n- Do not run destructive commands without explicit approval.\n- Do not expose secrets from logs, env files, or command output.\n`,
  },
  {
    name: "writing-editor",
    title: "Writing Editor",
    description: "Improves clarity, structure, and tone while preserving the user's voice.",
    category: "writing",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Writing Editor\n\nUse this skill when the user asks to rewrite, polish, shorten, expand, or clarify writing.\n\n## Behavior\n\n- Preserve the user's intent and voice.\n- Ask for audience and tone when unclear.\n- Offer a clean version first, then optional notes if helpful.\n- Keep sensitive or private content private; do not invent facts.\n`,
  },
  {
    name: "learning-tutor",
    title: "Learning Tutor",
    description: "Explains concepts with examples, checks understanding, and adapts difficulty.",
    category: "learning",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Learning Tutor\n\nUse this skill when the user wants to learn, practice, or understand a topic.\n\n## Behavior\n\n- Start from the user's current level.\n- Explain with one simple analogy and one concrete example.\n- Check understanding with a small question or exercise when useful.\n- Avoid pretending certainty; mark uncertain claims clearly.\n`,
  },
  {
    name: "memory-curator",
    title: "Memory Curator",
    description: "Helps decide what should be remembered, forgotten, summarized, or kept private.",
    category: "memory",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "medium",
    permissions: ["memory_read", "memory_write"],
    changelog: "Initial local curated template aligned with conservative memory defaults.",
    content: `# Memory Curator\n\nUse this skill when the user reviews memories, asks what to save, or wants to clean up context.\n\n## Behavior\n\n- Separate durable preferences from temporary tasks and sensitive data.\n- Recommend saving only stable, useful, user-approved facts.\n- Prefer summaries over raw private content.\n- Suggest forgetting stale, duplicate, or overly sensitive items.\n\n## Safety\n\n- Do not save secrets, credentials, or private third-party data.\n- Follow the configured memory write policy and approval requirements.\n`,
  },
  {
    name: "channel-operator",
    title: "Channel Operator",
    description: "Guides safe Telegram, Zalo, cron, daemon, and service operations.",
    category: "operations",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "medium",
    permissions: ["local_action"],
    changelog: "Initial local curated template with restart/setup confirmation rules.",
    content: `# Channel Operator\n\nUse this skill when the user manages Telegram, Zalo, cron, daemon, service, or local runtime status.\n\n## Behavior\n\n- Summarize current state before recommending changes.\n- Prefer safe diagnostics before restart, install, uninstall, or token changes.\n- Explain the command or UI action and expected result.\n\n## Safety\n\n- Never display tokens or raw .env contents.\n- Require explicit confirmation before restart, install, uninstall, destructive cleanup, or external-send actions.\n`,
  },
  {
    name: "research-synthesizer",
    title: "Research Synthesizer",
    description: "Converts notes or sources into a concise answer with caveats and next questions.",
    category: "research",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Research Synthesizer\n\nUse this skill when the user provides notes, excerpts, or sources and asks for synthesis.\n\n## Behavior\n\n- Extract the main claim, supporting evidence, contradictions, and unknowns.\n- Distinguish source-backed statements from inference.\n- Keep summaries short unless the user asks for detail.\n- Suggest the next 2-3 questions that would reduce uncertainty.\n`,
  },
  {
    name: "gentle-accountability",
    title: "Gentle Accountability",
    description: "Keeps the user moving with direct but kind check-ins and realistic commitments.",
    category: "personal",
    version: "1.0.0",
    author: "Bestie",
    trust: "official",
    risk: "low",
    permissions: [],
    changelog: "Initial local curated template.",
    content: `# Gentle Accountability\n\nUse this skill when the user wants motivation, follow-through, habit support, or a reset after avoidance.\n\n## Behavior\n\n- Be warm, direct, and non-shaming.\n- Shrink the commitment until it is realistic today.\n- Ask for a clear next check-in only if the user wants one.\n- Celebrate progress without overpromising outcomes.\n\n## Boundaries\n\n- Do not act as a therapist replacement or diagnose mental health conditions.\n- Encourage professional or emergency help for crisis or self-harm signals.\n`,
  },
];
export function listCuratedSkillTemplates(): CuratedSkillTemplate[] {
  return [...CURATED_SKILL_LIBRARY];
}

export function createBundledSkillRegistrySnapshot(): SkillRegistrySnapshot {
  const skills = listCuratedSkillTemplates();
  const validation = validateCuratedSkillRegistry(skills);
  const registryHash = hashSkillRegistry(skills);
  return {
    source: {
      id: "bundled-official",
      name: "Bundled Official Skills",
      kind: "bundled",
      enabled: true,
      trust: "official",
      skillCount: skills.length,
      verification: validation.ok
        ? { status: "verified", method: "bundled-sha256", detail: "Bundled registry passed schema validation and local checksum generation.", registryHash }
        : { status: "failed", method: "bundled-sha256", detail: "Bundled registry failed schema validation.", registryHash },
    },
    skills,
    validation,
    registryHash,
  };
}

export function listSkillRegistrySources(options: { remoteOfficial?: RemoteSkillRegistryConfig } = {}): SkillRegistrySource[] {
  const bundled = createBundledSkillRegistrySnapshot().source;
  const remote = options.remoteOfficial;
  return [
    bundled,
    {
      id: "remote-official",
      name: "Remote Official Registry",
      kind: "remote",
      enabled: remote?.enabled === true,
      trust: "official",
      skillCount: 0,
      verification: remote?.enabled === true
        ? remote.publicKey
          ? { status: "unsigned", method: "signature", detail: `Remote registry configured at ${remote.url}; fetch and signature verification are not enabled in the local MVP yet.` }
          : { status: "failed", method: "signature", detail: `Remote registry configured at ${remote.url} but no public key is configured.` }
        : { status: "unavailable", method: "signature", detail: "Remote registry and signature verification are disabled by default in the local MVP." },
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
    return parseRemoteSkillRegistryPayload(payload, { config: options.config, signature });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseRemoteSkillRegistryPayload(payload: string, options: { config: RemoteSkillRegistryConfig; signature?: string }): SkillRegistrySnapshot {
  const parsed = JSON.parse(payload) as unknown;
  const document = parseRemoteSkillRegistryDocument(parsed);
  const validation = withRemoteRegistryIdentityValidation(validateCuratedSkillRegistry(document.skills), document);
  const registryHash = hashSkillRegistry(document.skills);
  const verification = verifyRemoteRegistryPayload(payload, options.config.publicKey, options.signature, registryHash, validation.ok);

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

function withRemoteRegistryIdentityValidation(validation: SkillRegistryValidationResult, document: RemoteSkillRegistryDocument): SkillRegistryValidationResult {
  const issues = [...validation.issues];
  if (document.source.id === "bundled-official") {
    issues.push({ field: "source.id", message: "Remote registry source id cannot be bundled-official." });
  }
  const bundledNames = new Set(CURATED_SKILL_LIBRARY.map((skill) => skill.name));
  for (const skill of document.skills) {
    if (bundledNames.has(skill.name)) {
      issues.push({ name: skill.name, field: "name", message: "Remote skill name cannot collide with a bundled skill." });
    }
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

export function findCuratedSkillTemplate(name: string): CuratedSkillTemplate | undefined {
  const skillName = normalizeSkillName(name);
  return CURATED_SKILL_LIBRARY.find((item) => item.name === skillName);
}

export function getCuratedSkillTemplateOrThrow(name: string): CuratedSkillTemplate {
  const skill = findCuratedSkillTemplate(name);
  if (!skill) throw new Error("Skill library item was not found.");
  return skill;
}

export function validateCuratedSkillRegistry(skills: CuratedSkillTemplate[] = CURATED_SKILL_LIBRARY): SkillRegistryValidationResult {
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

export function hashSkillRegistry(skills: CuratedSkillTemplate[] = CURATED_SKILL_LIBRARY): string {
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

function verifyRemoteRegistryPayload(payload: string, publicKey: string | undefined, signature: string | undefined, registryHash: string, validationOk: boolean): SkillRegistryVerification {
  if (!validationOk) return { status: "failed", method: "signature", detail: "Remote registry failed schema validation.", registryHash };
  if (!publicKey) return { status: "failed", method: "signature", detail: "Remote registry public key is missing.", registryHash };
  if (!signature) return { status: "unsigned", method: "signature", detail: "Remote registry did not include a detached signature.", registryHash };
  return verifyDetachedSignature(payload, signature, publicKey)
    ? { status: "verified", method: "signature", detail: "Remote registry signature verified.", registryHash }
    : { status: "failed", method: "signature", detail: "Remote registry signature verification failed.", registryHash };
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
