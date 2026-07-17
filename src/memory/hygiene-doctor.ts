import type { MemoryHygienePlanResult } from "../tools/local-read-tools.js";
import type { MemoryDeletePolicy, MemoryRetrievalPolicy } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getMemoryMaintenanceReportStatus, installMemoryMaintenanceReport } from "./maintenance.js";
import { calculateMemoryHygieneScore, formatMemoryHygieneScore, type MemoryHygieneScore } from "./hygiene-score.js";
import { formatMemoryHygieneTrend, type MemoryHygieneTrend } from "./hygiene-trend.js";
import { SqliteMemoryStore } from "./sqlite-store.js";

export type MemoryHygieneDoctorStatus = "pass" | "warn" | "fail";

export interface MemoryHygieneDoctorCheck {
  name: string;
  status: MemoryHygieneDoctorStatus;
  message: string;
  fix?: string;
}

export interface MemoryHygieneDoctorReport {
  checks: MemoryHygieneDoctorCheck[];
  issueCount: number;
  score: MemoryHygieneScore;
}

export interface MemoryHygieneDoctorFix {
  name: string;
  status: "fixed" | "skipped" | "failed";
  message: string;
}

const FULL_RETRIEVAL_WARN_ACTIVE_MEMORIES = 100;
const SESSION_STALE_WARN_MEMORIES = 10;

export async function buildMemoryHygieneDoctorReport(options: {
  paths: RuntimePaths;
  plan: MemoryHygienePlanResult;
  deletePolicy: MemoryDeletePolicy;
  retrievalPolicy: MemoryRetrievalPolicy;
}): Promise<MemoryHygieneDoctorReport> {
  const { paths, plan, deletePolicy, retrievalPolicy } = options;
  const checks: MemoryHygieneDoctorCheck[] = [];

  if (!plan.allowed) {
    checks.push({ name: "Memory hygiene planner", status: "fail", message: plan.reason });
    return { checks, issueCount: 1, score: calculateMemoryHygieneScore(plan, checks) };
  }

  const activeMemories = await listActiveMemories(paths);
  const sessionIds = new Set(activeMemories.filter((memory) => memory.scope === "session").map((memory) => memory.id));
  const sessionStaleCount = plan.staleMemories.filter((memory) => sessionIds.has(memory.id)).length;
  const maintenanceSchedule = await getMemoryMaintenanceReportStatus(paths);

  checks.push(checkRetrievalPolicy(retrievalPolicy, activeMemories.length));
  checks.push(checkDeletePolicy(deletePolicy, plan.reviewOnlyIds.length));
  checks.push(checkMaintenanceSchedule(Boolean(maintenanceSchedule)));
  checks.push(checkSessionHygiene(sessionStaleCount));
  checks.push(checkDeleteCandidates(plan.deleteIds.length));

  return { checks, issueCount: checks.filter((check) => check.status !== "pass").length, score: calculateMemoryHygieneScore(plan, checks) };
}

export function formatMemoryHygieneDoctorReport(report: MemoryHygieneDoctorReport, trend?: MemoryHygieneTrend): string {
  const lines = [`Memory hygiene doctor: ${report.issueCount === 0 ? "pass" : `${report.issueCount} issue(s)`}`, formatMemoryHygieneScore(report.score)];
  if (trend) {
    lines.push(formatMemoryHygieneTrend(trend));
  }

  for (const check of report.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
    if (check.fix) {
      lines.push(`Fix: ${check.fix}`);
    }
  }

  return lines.join("\n");
}

export async function fixMemoryHygieneDoctorIssues(options: { paths: RuntimePaths; report: MemoryHygieneDoctorReport }): Promise<MemoryHygieneDoctorFix[]> {
  const fixes: MemoryHygieneDoctorFix[] = [];
  const needsMaintenanceDigest = options.report.checks.some((check) => check.name === "Maintenance digest" && check.status !== "pass");

  if (needsMaintenanceDigest) {
    const result = await installMemoryMaintenanceReport({ paths: options.paths });
    fixes.push(result.ok
      ? { name: "Maintenance digest", status: "fixed", message: `Installed weekly memory hygiene digest: #${result.schedule.id}.` }
      : { name: "Maintenance digest", status: "failed", message: result.reason });
  }

  const unsafeFixes = options.report.checks.filter((check) => check.status !== "pass" && check.name !== "Maintenance digest");
  for (const check of unsafeFixes) {
    fixes.push({ name: check.name, status: "skipped", message: check.fix ?? "Manual review required." });
  }

  return fixes;
}

export function formatMemoryHygieneDoctorFixes(fixes: MemoryHygieneDoctorFix[]): string {
  if (fixes.length === 0) {
    return "Memory hygiene doctor fixes: nothing to fix safely.";
  }

  return [
    "Memory hygiene doctor fixes",
    ...fixes.map((fix) => `[${fix.status.toUpperCase()}] ${fix.name}: ${fix.message}`),
  ].join("\n");
}

async function listActiveMemories(paths: RuntimePaths) {
  const store = await SqliteMemoryStore.open(paths);

  try {
    return store.listActiveMemories();
  } finally {
    store.close();
  }
}

function checkRetrievalPolicy(retrievalPolicy: MemoryRetrievalPolicy, activeCount: number): MemoryHygieneDoctorCheck {
  if (retrievalPolicy === "full" && activeCount > FULL_RETRIEVAL_WARN_ACTIVE_MEMORIES) {
    return {
      name: "Retrieval pressure",
      status: "warn",
      message: `memory.retrievalPolicy is full with ${activeCount} active memories.`,
      fix: "Run `bestie memory governance policy governed` if prompts feel noisy or slow.",
    };
  }

  return { name: "Retrieval pressure", status: "pass", message: `memory.retrievalPolicy=${retrievalPolicy}; active memories=${activeCount}.` };
}

function checkDeletePolicy(deletePolicy: MemoryDeletePolicy, reviewOnlyCount: number): MemoryHygieneDoctorCheck {
  if (deletePolicy === "allow" && reviewOnlyCount > 0) {
    return {
      name: "Delete policy",
      status: "warn",
      message: `memory.deletePolicy is allow while ${reviewOnlyCount} memory/memories require review-only handling.`,
      fix: "Inspect review-only memories before broad cleanup, or set `memory.deletePolicy` to `ask`.",
    };
  }

  return { name: "Delete policy", status: "pass", message: `memory.deletePolicy=${deletePolicy}; review-only memories=${reviewOnlyCount}.` };
}

function checkMaintenanceSchedule(installed: boolean): MemoryHygieneDoctorCheck {
  if (!installed) {
    return {
      name: "Maintenance digest",
      status: "warn",
      message: "Weekly memory hygiene digest is not installed.",
      fix: "Run `bestie memory maintenance install` or `/memory maintenance install`.",
    };
  }

  return { name: "Maintenance digest", status: "pass", message: "Weekly memory hygiene digest is installed." };
}

function checkSessionHygiene(sessionStaleCount: number): MemoryHygieneDoctorCheck {
  if (sessionStaleCount >= SESSION_STALE_WARN_MEMORIES) {
    return {
      name: "Session memory expiry",
      status: "warn",
      message: `${sessionStaleCount} session memories are stale cleanup candidates.`,
      fix: "Run `bestie memory hygiene status`, then apply cleanup if the plan is expected.",
    };
  }

  return { name: "Session memory expiry", status: "pass", message: `${sessionStaleCount} stale session memory/memories.` };
}

function checkDeleteCandidates(deleteCandidateCount: number): MemoryHygieneDoctorCheck {
  if (deleteCandidateCount > 0) {
    return {
      name: "Cleanup candidates",
      status: "warn",
      message: `${deleteCandidateCount} duplicate/stale memory candidate(s) can be cleaned.`,
      fix: "Run `bestie memory hygiene status` to review the next safe command.",
    };
  }

  return { name: "Cleanup candidates", status: "pass", message: "No duplicate/stale memory cleanup candidates." };
}