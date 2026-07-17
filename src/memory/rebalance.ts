import type { MemoryScope, SqliteMemoryStore, StoredMemory } from "./sqlite-store.js";

export interface MemoryRebalanceRecommendation {
  id: number;
  type: string;
  currentScope: MemoryScope;
  recommendedScope: MemoryScope;
  reason: string;
  reviewOnly: boolean;
}

export interface MemoryRebalancePlan {
  checked: number;
  recommendations: MemoryRebalanceRecommendation[];
  reviewOnlyIds: number[];
}

export interface MemoryRebalanceApplyResult {
  moved: Array<{ id: number; from: MemoryScope; to: MemoryScope }>;
  missingIds: number[];
  skippedReviewOnlyIds: number[];
}

export function planMemoryRebalance(memories: StoredMemory[]): MemoryRebalancePlan {
  const recommendations = memories.flatMap((memory) => {
    const recommendedScope = recommendMemoryScope(memory);

    if (memory.scope === recommendedScope) {
      return [];
    }

    const reviewOnly = memory.pinned || memory.sensitivity === "secret";
    return [{
      id: memory.id,
      type: memory.type,
      currentScope: memory.scope,
      recommendedScope,
      reason: explainScopeRecommendation(memory, recommendedScope),
      reviewOnly,
    }];
  });

  return {
    checked: memories.length,
    recommendations,
    reviewOnlyIds: recommendations.filter((recommendation) => recommendation.reviewOnly).map((recommendation) => recommendation.id),
  };
}

export function formatMemoryRebalancePlan(options: { plan: MemoryRebalancePlan; channelCommandPrefix?: string }): string {
  const { plan, channelCommandPrefix } = options;
  const actionable = plan.recommendations.filter((recommendation) => !recommendation.reviewOnly);
  const lines = [`Memory rebalance dry-run (${plan.checked} checked)`];

  if (plan.recommendations.length === 0) {
    lines.push("No scope changes recommended.");
    return lines.join("\n");
  }

  lines.push(`Recommended moves: ${actionable.length}`);
  lines.push(`Review-only moves: ${plan.reviewOnlyIds.length}${plan.reviewOnlyIds.length > 0 ? ` (${plan.reviewOnlyIds.map((id) => `#${id}`).join(", ")})` : ""}`);

  for (const recommendation of plan.recommendations) {
    const marker = recommendation.reviewOnly ? "review" : "move";
    lines.push(`#${recommendation.id} [${recommendation.type}] ${recommendation.currentScope} -> ${recommendation.recommendedScope} (${marker})`);
    lines.push(`  ${recommendation.reason}`);
  }

  if (channelCommandPrefix) {
    lines.push(`Next: ${channelCommandPrefix} move <id> core|project|session after review.`);
  } else {
    lines.push("Next: bestie memory move <id> core|project|session after review.");
  }

  return lines.join("\n");
}

export function applyMemoryRebalancePlan(store: SqliteMemoryStore, plan: MemoryRebalancePlan): MemoryRebalanceApplyResult {
  const moved: MemoryRebalanceApplyResult["moved"] = [];
  const missingIds: number[] = [];
  const skippedReviewOnlyIds = plan.reviewOnlyIds;

  for (const recommendation of plan.recommendations) {
    if (recommendation.reviewOnly) {
      continue;
    }

    const updated = store.setMemoryScope(recommendation.id, recommendation.recommendedScope);
    if (!updated) {
      missingIds.push(recommendation.id);
      continue;
    }

    moved.push({ id: updated.id, from: recommendation.currentScope, to: updated.scope });
  }

  return { moved, missingIds, skippedReviewOnlyIds };
}

export function formatMemoryRebalanceApplyResult(result: MemoryRebalanceApplyResult): string {
  const lines = [`Memory rebalance applied: ${result.moved.length} moved`];

  if (result.moved.length > 0) {
    lines.push(`Moved: ${result.moved.map((move) => `#${move.id} ${move.from}->${move.to}`).join(", ")}`);
  }

  if (result.skippedReviewOnlyIds.length > 0) {
    lines.push(`Review-only skipped: ${result.skippedReviewOnlyIds.map((id) => `#${id}`).join(", ")}`);
  }

  if (result.missingIds.length > 0) {
    lines.push(`Missing: ${result.missingIds.map((id) => `#${id}`).join(", ")}`);
  }

  return lines.join("\n");
}

function recommendMemoryScope(memory: StoredMemory): MemoryScope {
  if (memory.type === "project_context") {
    return "project";
  }

  if (memory.type === "one_off") {
    return "session";
  }

  return "core";
}

function explainScopeRecommendation(memory: StoredMemory, recommendedScope: MemoryScope): string {
  if (recommendedScope === "project") {
    return "project_context belongs in project so it can be separated from durable owner preferences.";
  }

  if (recommendedScope === "session") {
    return "one_off memory belongs in session so it can expire instead of polluting durable memory.";
  }

  return `${memory.type} is durable identity, preference, decision, or sensitive context and should stay in core.`;
}