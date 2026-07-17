import type { MemoryHygienePlanResult } from "../tools/local-read-tools.js";
import type { MemoryDeletePolicy, MemoryRetrievalPolicy } from "../runtime/config.js";
import { calculateMemoryHygieneScore, formatMemoryHygieneScore } from "./hygiene-score.js";
import { formatMemoryHygieneTrend, type MemoryHygieneTrend } from "./hygiene-trend.js";

export interface MemoryHygieneStatusOptions {
  plan: MemoryHygienePlanResult;
  deletePolicy: MemoryDeletePolicy;
  retrievalPolicy: MemoryRetrievalPolicy;
  channelCommand?: string;
  trend?: MemoryHygieneTrend;
}

export function formatMemoryHygieneStatus(options: MemoryHygieneStatusOptions): string {
  const { plan, deletePolicy, retrievalPolicy, channelCommand, trend } = options;

  if (!plan.allowed) {
    return `Memory hygiene status denied: ${plan.reason}`;
  }

  const duplicateCount = plan.duplicateGroups.reduce((count, group) => count + group.duplicateIds.length, 0);
  const conflictCount = new Set(plan.conflictGroups.flatMap((group) => group.ids)).size;
  const safeCommand = nextSafeHygieneCommand(deletePolicy, channelCommand);
  const score = calculateMemoryHygieneScore(plan);

  return [
    `Memory hygiene status (${plan.checked} checked)`,
    formatMemoryHygieneScore(score),
    ...(trend ? [formatMemoryHygieneTrend(trend)] : []),
    `Retrieval policy: ${retrievalPolicy}`,
    `Delete policy: ${deletePolicy}`,
    `Delete candidates: ${plan.deleteIds.length}${plan.deleteIds.length > 0 ? ` (${plan.deleteIds.map((id) => `#${id}`).join(", ")})` : ""}`,
    `Review-only memories: ${plan.reviewOnlyIds.length}${plan.reviewOnlyIds.length > 0 ? ` (${plan.reviewOnlyIds.map((id) => `#${id}`).join(", ")})` : ""}`,
    `Duplicate memories: ${duplicateCount} across ${plan.duplicateGroups.length} group(s)`,
    `Stale memories: ${plan.staleMemories.length}`,
    `Conflict memories: ${conflictCount} across ${plan.conflictGroups.length} group(s)`,
    `Next safe command: ${safeCommand}`,
  ].join("\n");
}

function nextSafeHygieneCommand(deletePolicy: MemoryDeletePolicy, channelCommand?: string): string {
  if (deletePolicy === "deny") {
    return "Change memory.deletePolicy before applying cleanup.";
  }

  if (channelCommand) {
    return deletePolicy === "ask" ? `${channelCommand} confirm` : channelCommand;
  }

  return deletePolicy === "ask" ? "bestie memory hygiene --apply --yes" : "bestie memory hygiene --apply";
}