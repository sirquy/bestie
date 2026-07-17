import type { RuntimePaths } from "../runtime/paths.js";
import type { MemoryHygienePlanResult, MemoryHygieneTrendResult } from "../tools/local-read-tools.js";
import type { MemoryHygieneScore } from "./hygiene-score.js";
import { SqliteMemoryStore } from "./sqlite-store.js";

export interface MemoryHygieneTrend {
  previousScore?: number;
  delta?: number;
  direction: "new" | "up" | "down" | "flat";
}

export async function recordMemoryHygieneSnapshot(options: {
  paths: RuntimePaths;
  plan: MemoryHygienePlanResult;
  score: MemoryHygieneScore;
  source: string;
}): Promise<MemoryHygieneTrend> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const previous = store.listMemoryHygieneSnapshots(1)[0];
    store.addMemoryHygieneSnapshot({
      score: options.score.score,
      label: options.score.label,
      checked: options.plan.checked,
      deleteCandidates: options.plan.deleteIds.length,
      reviewOnly: options.plan.reviewOnlyIds.length,
      duplicateGroups: options.plan.duplicateGroups.length,
      staleMemories: options.plan.staleMemories.length,
      conflictGroups: options.plan.conflictGroups.length,
      source: options.source,
    });

    if (!previous) {
      return { direction: "new" };
    }

    const delta = options.score.score - previous.score;
    return {
      previousScore: previous.score,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    };
  } finally {
    store.close();
  }
}

export function formatMemoryHygieneTrend(trend: MemoryHygieneTrend): string {
  if (trend.direction === "new" || trend.previousScore === undefined || trend.delta === undefined) {
    return "Memory hygiene trend: baseline snapshot saved";
  }

  if (trend.direction === "flat") {
    return `Memory hygiene trend: unchanged from previous snapshot (${trend.previousScore}/100)`;
  }

  const sign = trend.delta > 0 ? "+" : "";
  return `Memory hygiene trend: ${sign}${trend.delta} since previous snapshot (${trend.previousScore}/100)`;
}

export function formatMemoryHygieneTrendReport(result: MemoryHygieneTrendResult): string {
  if (!result.allowed) {
    return `Memory hygiene trend denied: ${result.reason}`;
  }

  if (!result.latest) {
    return "Memory hygiene trend: no snapshots yet. Run `bestie memory hygiene status` or `/memory hygiene status` first.";
  }

  const latest = result.latest;
  const baseline = result.baseline;
  const direction = result.direction === "new" || result.delta === undefined || !baseline || baseline.id === latest.id
    ? "baseline"
    : `${result.direction} (${result.delta > 0 ? "+" : ""}${result.delta}) from #${baseline.id}`;

  return [
    `Memory hygiene trend (${result.snapshots.length} snapshot(s))`,
    `Latest: #${latest.id} ${latest.score}/100 (${latest.label}) from ${latest.source} at ${latest.createdAt}`,
    `Direction: ${direction}`,
    "Recent snapshots:",
    ...result.snapshots.map((snapshot) => `#${snapshot.id} ${snapshot.score}/100 (${snapshot.label}) delete=${snapshot.deleteCandidates} review=${snapshot.reviewOnly} source=${snapshot.source}`),
  ].join("\n");
}
