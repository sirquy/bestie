import type { MemoryHygienePlanResult } from "../tools/local-read-tools.js";
import type { MemoryHygieneDoctorCheck } from "./hygiene-doctor.js";

export interface MemoryHygieneScore {
  score: number;
  label: "healthy" | "attention" | "needs cleanup";
}

export function calculateMemoryHygieneScore(plan: MemoryHygienePlanResult, checks: MemoryHygieneDoctorCheck[] = []): MemoryHygieneScore {
  if (!plan.allowed) {
    return { score: 0, label: "needs cleanup" };
  }

  const duplicateCount = plan.duplicateGroups.reduce((count, group) => count + group.duplicateIds.length, 0);
  const conflictCount = new Set(plan.conflictGroups.flatMap((group) => group.ids)).size;
  const warningCount = checks.filter((check) => check.status === "warn").length;
  const failureCount = checks.filter((check) => check.status === "fail").length;
  const penalty = Math.min(40, plan.deleteIds.length * 8)
    + Math.min(25, plan.reviewOnlyIds.length * 5)
    + Math.min(20, duplicateCount * 5)
    + Math.min(20, plan.staleMemories.length * 4)
    + Math.min(20, conflictCount * 5)
    + Math.min(15, warningCount * 3)
    + Math.min(30, failureCount * 10);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { score, label: score >= 85 ? "healthy" : score >= 60 ? "attention" : "needs cleanup" };
}

export function formatMemoryHygieneScore(score: MemoryHygieneScore): string {
  return `Memory hygiene score: ${score.score}/100 (${score.label})`;
}