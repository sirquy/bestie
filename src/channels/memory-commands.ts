import type { AnalyzeMemoriesResult } from "../tools/local-read-tools.js";

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