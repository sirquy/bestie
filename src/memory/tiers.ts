import type { StoredMemory } from "./sqlite-store.js";
import type { MemoryHygienePlanResult } from "../tools/local-read-tools.js";

export function formatMemoryTiersReport(options: { memories: StoredMemory[]; plan: MemoryHygienePlanResult; channelCommandPrefix?: string }): string {
  const { memories, plan, channelCommandPrefix } = options;
  const scopes = ["core", "project", "session"] as const;
  const staleIds = new Set(plan.staleMemories.map((memory) => memory.id));
  const expiringSessionCount = memories.filter((memory) => memory.scope === "session" && memory.expiresAt !== undefined && Date.parse(memory.expiresAt) <= Date.now() + 7 * 24 * 60 * 60 * 1000).length;
  const lines = [`Memory tiers (${memories.length} active)`];

  for (const scope of scopes) {
    const scoped = memories.filter((memory) => memory.scope === scope);
    const pinned = scoped.filter((memory) => memory.pinned).length;
    const stale = scoped.filter((memory) => staleIds.has(memory.id)).length;
    lines.push(`${scope}: ${scoped.length} active, ${pinned} pinned, ${stale} stale`);
  }

  lines.push(`Session expiring within 7 days: ${expiringSessionCount}`);
  lines.push(`Review-only memories: ${plan.reviewOnlyIds.length}${plan.reviewOnlyIds.length > 0 ? ` (${plan.reviewOnlyIds.map((id) => `#${id}`).join(", ")})` : ""}`);
  lines.push(`Delete candidates: ${plan.deleteIds.length}${plan.deleteIds.length > 0 ? ` (${plan.deleteIds.map((id) => `#${id}`).join(", ")})` : ""}`);

  if (channelCommandPrefix) {
    lines.push(`Next: ${channelCommandPrefix} scope session, ${channelCommandPrefix} hygiene status, or ${channelCommandPrefix} hygiene apply confirm.`);
  } else {
    lines.push("Next: bestie memory list --scope session, bestie memory hygiene status, or bestie memory hygiene --apply --yes.");
  }

  return lines.join("\n");
}