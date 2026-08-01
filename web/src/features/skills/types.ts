export interface SkillsSummary {
  ok: true;
  count: number;
  skillsDir: string;
  skills: Skill[];
}

export interface Skill {
  name: string;
  path: string;
  bytes: number;
  preview: string;
  currentHash: string;
  localChanges: boolean;
  rollbackAvailable: boolean;
  enabled: boolean;
  manifest?: InstalledSkillManifest;
}

export interface SkillItemResponse {
  ok: true;
  name: string;
  path: string;
  content: string;
  manifest?: InstalledSkillManifest;
}

export interface SkillLibrarySummary {
  ok: true;
  count: number;
  installedCount: number;
  registry: SkillRegistrySummary;
  skills: SkillLibraryItem[];
}

export interface SkillRegistrySummary {
  activeSource: SkillRegistrySource;
  sources: SkillRegistrySource[];
  validation: { ok: boolean; errors?: string[]; warnings?: string[]; [key: string]: unknown };
  registryHash: string;
}

export interface SkillRegistrySource {
  id: string;
  name: string;
  enabled: boolean;
  readOnly?: boolean;
  verification?: { status?: string; method?: string; registryHash?: string; [key: string]: unknown };
  cache?: { cachedAt?: string; ageMs?: number; status?: string };
  [key: string]: unknown;
}

export interface SkillLibraryItem {
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
  verificationStatus: string;
  verificationMethod: string;
  cache?: { cachedAt?: string; ageMs?: number; status?: string };
}

export interface SkillLibraryItemResponse {
  ok: true;
  skill: SkillLibraryItem;
  content: string;
}

export interface SkillLibraryDiff {
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
  preview: SkillDiffLine[];
  rollbackAvailable: boolean;
  manifest?: InstalledSkillManifest;
}

export interface SkillDiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface InstalledSkillManifest {
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

export interface SkillRemoteRegistryTestResult {
  ok: true;
  configured: boolean;
  enabled: boolean;
  source?: SkillRegistrySource;
  validation?: SkillRegistrySummary["validation"];
  registryHash?: string;
  error?: string;
}
