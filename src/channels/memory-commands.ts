import type { AnalyzeMemoriesResult } from "../tools/local-read-tools.js";
import type { CronSchedule, StoredMemory } from "../memory/sqlite-store.js";
import type { MemoryRetrievalPolicy } from "../runtime/config.js";

export function formatMemoryAnalysisReport(analysis: AnalyzeMemoriesResult): string {
  if (!analysis.allowed) {
    return `Memory analysis denied: ${analysis.reason}`;
  }

  const lines = [`Memory analysis (${analysis.checked} checked)`];
  appendDuplicateGroups(lines, analysis.duplicateGroups);
  appendStaleMemories(lines, analysis.staleMemories);
  appendConflictGroups(lines, analysis.conflictGroups);

  if (lines.length === 1) {
    lines.push("No duplicate, stale, or conflicting active memories found.");
  }

  return lines.join("\n");
}

export function formatMemoryCleanupDryRunReport(analysis: AnalyzeMemoriesResult): string {
  if (!analysis.allowed) {
    return `Memory cleanup dry-run denied: ${analysis.reason}`;
  }

  const duplicateIds = analysis.duplicateGroups.flatMap((group) => group.duplicateIds);
  const staleIds = analysis.staleMemories.map((memory) => memory.id);
  const deleteIds = [...new Set([...duplicateIds, ...staleIds])].sort((left, right) => left - right);
  const lines = [`Memory cleanup dry-run (${analysis.checked} checked)`];

  if (deleteIds.length === 0) {
    lines.push("No duplicate or stale memories planned for deletion.");
  } else {
    lines.push(`Would delete: ${deleteIds.map((id) => `#${id}`).join(", ")}`);
    appendDuplicateGroups(lines, analysis.duplicateGroups);
    appendStaleMemories(lines, analysis.staleMemories);
  }

  if (analysis.conflictGroups.length > 0) {
    appendConflictGroups(lines, analysis.conflictGroups);
    lines.push("Conflicts are review-only and are not auto-deleted.");
  }

  return lines.join("\n");
}

export function formatMemoryMaintenanceInstalled(schedule: CronSchedule): string {
  return [
    `Memory maintenance report installed: #${schedule.id}`,
    `Schedule: ${schedule.scheduleValue}`,
    `Channel: ${schedule.channel ?? "configured owner channels"}`,
    `Next run: ${schedule.nextRunAt}`,
  ].join("\n");
}

export function formatMemoryMaintenanceStatus(schedule: CronSchedule | undefined): string {
  if (!schedule) {
    return "Memory maintenance report is not installed.";
  }

  return [
    `Memory maintenance report: #${schedule.id} ${schedule.enabled ? "enabled" : "disabled"}`,
    `Schedule: ${schedule.scheduleValue}`,
    `Channel: ${schedule.channel ?? "configured owner channels"}`,
    `Next run: ${schedule.nextRunAt || "none"}`,
    `Last result: ${schedule.lastResult ?? "none"}`,
  ].join("\n");
}

export function formatMemoryMaintenanceRemoved(schedule: CronSchedule | undefined): string {
  return schedule ? `Memory maintenance report removed: #${schedule.id}` : "Memory maintenance report is not installed.";
}

export function formatMemoryGovernanceStatus(analysis: AnalyzeMemoriesResult, retrievalPolicy: MemoryRetrievalPolicy): string {
  if (!analysis.allowed) {
    return `Memory governance status denied: ${analysis.reason}`;
  }

  const duplicateCount = analysis.duplicateGroups.reduce((count, group) => count + group.duplicateIds.length, 0);
  const conflictMemoryCount = new Set(analysis.conflictGroups.flatMap((group) => group.ids)).size;

  return [
    "Memory governance status",
    `Retrieval policy: ${retrievalPolicy}`,
    `Active checked: ${analysis.checked}`,
    `Duplicate memories: ${duplicateCount} across ${analysis.duplicateGroups.length} group(s)`,
    `Stale memories: ${analysis.staleMemories.length}`,
    `Conflict memories: ${conflictMemoryCount} across ${analysis.conflictGroups.length} group(s)`,
  ].join("\n");
}

export function formatMemoryRetrievalPolicyUpdated(policy: MemoryRetrievalPolicy): string {
  return `memory.retrievalPolicy set to ${policy}.`;
}

export function formatMemoryInspect(memory: StoredMemory): string {
  return [
    `Memory #${memory.id}`,
    `Type: ${memory.type}`,
    `Scope: ${memory.scope}`,
    `Status: ${memory.status}`,
    `Importance: ${memory.importance}`,
    `Sensitivity: ${memory.sensitivity}`,
    `Pinned: ${memory.pinned ? "yes" : "no"}`,
    `Confidence: ${memory.confidence}`,
    memory.expiresAt ? `Expires: ${memory.expiresAt}` : undefined,
    memory.supersededBy ? `Superseded by: #${memory.supersededBy}` : undefined,
    memory.source ? `Source: ${memory.source}` : undefined,
    memory.policyReason ? `Policy reason: ${memory.policyReason}` : undefined,
    `Created: ${memory.createdAt}`,
    `Updated: ${memory.updatedAt}`,
    "Content:",
    memory.content,
  ].filter(Boolean).join("\n");
}

function appendDuplicateGroups(lines: string[], groups: AnalyzeMemoriesResult["duplicateGroups"]): void {
  if (groups.length === 0) return;
  lines.push(`Duplicates: ${groups.length} group(s)`);
  for (const group of groups) {
    lines.push(`- Keep #${group.canonicalId}; duplicate(s): ${group.duplicateIds.map((id) => `#${id}`).join(", ")}. ${group.reason}`);
  }
}

function appendStaleMemories(lines: string[], memories: AnalyzeMemoriesResult["staleMemories"]): void {
  if (memories.length === 0) return;
  lines.push(`Stale: ${memories.length}`);
  for (const memory of memories) {
    lines.push(`- #${memory.id}: ${memory.reason}`);
  }
}

function appendConflictGroups(lines: string[], groups: AnalyzeMemoriesResult["conflictGroups"]): void {
  if (groups.length === 0) return;
  lines.push(`Conflicts: ${groups.length} group(s)`);
  for (const group of groups) {
    lines.push(`- Review ${group.ids.map((id) => `#${id}`).join(" <-> ")}. ${group.reason}`);
  }
}