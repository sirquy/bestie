import type { StoredMemory } from "./sqlite-store.js";
import type { MemoryHygienePlanResult, MemoryHygieneTrendResult } from "../tools/local-read-tools.js";
import type { MemoryRebalancePlan } from "./rebalance.js";
import { calculateMemoryHygieneScore, formatMemoryHygieneScore } from "./hygiene-score.js";
import { formatMemoryHygieneTrend, type MemoryHygieneTrend } from "./hygiene-trend.js";

export interface MemorySummaryOptions {
  memories: StoredMemory[];
  plan: MemoryHygienePlanResult;
  rebalance: MemoryRebalancePlan;
  trend?: MemoryHygieneTrend;
  deletePolicy: string;
  retrievalPolicy: string;
  channelCommandPrefix?: string;
}

export function formatMemorySummary(options: MemorySummaryOptions): string {
  const { memories, plan, rebalance, trend, deletePolicy, retrievalPolicy, channelCommandPrefix } = options;
  const lines: string[] = [];
  const cmd = channelCommandPrefix ?? "bestie memory";
  const move = channelCommandPrefix ? `${cmd} move <id> core|project|session` : `${cmd} move <id> --scope core|project|session`;

  // --- Header ---
  lines.push(`=== Memory Summary (${memories.length} active) ===`);
  lines.push("");

  // --- Tiers ---
  const scopes = ["core", "project", "session"] as const;
  const staleIds = new Set(plan.staleMemories.map((memory) => memory.id));
  const expiringSessionCount = memories.filter((memory) => memory.scope === "session" && memory.expiresAt !== undefined && Date.parse(memory.expiresAt) <= Date.now() + 7 * 24 * 60 * 60 * 1000).length;
  lines.push("[Tiers]");
  for (const scope of scopes) {
    const scoped = memories.filter((memory) => memory.scope === scope);
    const pinned = scoped.filter((memory) => memory.pinned).length;
    const stale = scoped.filter((memory) => staleIds.has(memory.id)).length;
    lines.push(`  ${scope}: ${scoped.length} active, ${pinned} pinned, ${stale} stale`);
  }
  if (expiringSessionCount > 0) {
    lines.push(`  Session expiring within 7 days: ${expiringSessionCount}`);
  }
  lines.push("");

  // --- Hygiene ---
  const score = calculateMemoryHygieneScore(plan);
  lines.push("[Hygiene]");
  lines.push(`  ${formatMemoryHygieneScore(score)}`);
  if (trend) {
    lines.push(`  ${formatMemoryHygieneTrend(trend)}`);
  }
  lines.push(`  Delete candidates: ${plan.deleteIds.length}`);
  lines.push(`  Review-only: ${plan.reviewOnlyIds.length}`);
  lines.push(`  Policies: delete=${deletePolicy}, retrieval=${retrievalPolicy}`);
  lines.push("");

  // --- Rebalance ---
  const actionable = rebalance.recommendations.filter((r) => !r.reviewOnly);
  lines.push("[Rebalance]");
  if (rebalance.recommendations.length === 0) {
    lines.push("  No scope drift detected.");
  } else {
    lines.push(`  Recommended moves: ${actionable.length}`);
    lines.push(`  Review-only moves: ${rebalance.reviewOnlyIds.length}`);
    for (const rec of rebalance.recommendations.slice(0, 10)) {
      const marker = rec.reviewOnly ? "review" : "move";
      lines.push(`  #${rec.id} [${rec.type}] ${rec.currentScope} -> ${rec.recommendedScope} (${marker})`);
    }
    if (rebalance.recommendations.length > 10) {
      lines.push(`  ... and ${rebalance.recommendations.length - 10} more`);
    }
  }
  lines.push("");

  // --- Next ---
  lines.push("[Next]");
  const nextCmds: string[] = [];
  if (plan.deleteIds.length > 0) {
    nextCmds.push(`${cmd} hygiene --apply --yes`);
  }
  if (actionable.length > 0) {
    nextCmds.push(`${cmd} rebalance --apply --yes`);
  }
  if (nextCmds.length === 0) {
    nextCmds.push(`${cmd} list --scope session`);
  }
  lines.push(`  ${nextCmds.join(" | ")}`);

  return lines.join("\n");
}
