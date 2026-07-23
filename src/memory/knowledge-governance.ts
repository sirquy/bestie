import type { KnowledgeEntity, KnowledgeRelationWithEntities, PendingKnowledgeItem } from "./sqlite-store.js";

export interface KnowledgeGraphAnalysis {
  checkedEntities: number;
  checkedRelations: number;
  orphanEntities: Array<{ id: number; name: string; kind: string; reason: string }>;
  lowConfidenceRelations: Array<{ id: number; relation: string; confidence: number; reason: string }>;
  mergeCandidates: Array<{ primaryId: number; duplicateId: number; kind: string; primaryName: string; duplicateName: string; reason: string }>;
  conflictingRelations: Array<{ relationIds: number[]; source: string; target: string; types: string[]; reason: string }>;
  pendingItems: Array<{ id: number; reason?: string }>; 
  score: number;
}

export type KnowledgeGraphReviewAction = "merge_entity" | "inspect_conflict" | "inspect_pending" | "inspect_low_confidence" | "inspect_orphan";

export interface KnowledgeGraphReviewSuggestion {
  action: KnowledgeGraphReviewAction;
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  command: string;
  toolCall?: { tool: string; arguments: Record<string, unknown> };
}

export interface KnowledgeGraphReviewPlan {
  score: number;
  issueCount: number;
  suggestions: KnowledgeGraphReviewSuggestion[];
  nextCommand?: string;
}

const CONFLICTING_RELATION_TYPES = new Map<string, string[]>([
  ["likes", ["dislikes"]],
  ["dislikes", ["likes", "prefers"]],
  ["prefers", ["dislikes"]],
  ["wants", ["blocked_by"]],
  ["blocked_by", ["wants", "depends_on"]],
  ["depends_on", ["blocked_by"]],
]);

export function analyzeKnowledgeGraph(options: {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelationWithEntities[];
  pending: PendingKnowledgeItem[];
}): KnowledgeGraphAnalysis {
  const connectedIds = new Set<number>();
  for (const relation of options.relations) {
    connectedIds.add(relation.sourceEntityId);
    connectedIds.add(relation.targetEntityId);
  }

  const orphanEntities = options.entities
    .filter((entity) => !connectedIds.has(entity.id))
    .map((entity) => ({ id: entity.id, name: entity.canonicalName, kind: entity.kind, reason: "Entity has no active one-hop relations." }));
  const lowConfidenceRelations = options.relations
    .filter((relation) => relation.confidence < 0.5)
    .map((relation) => ({
      id: relation.id,
      relation: `${relation.sourceEntity.canonicalName} --${relation.relationType}--> ${relation.targetEntity.canonicalName}`,
      confidence: relation.confidence,
      reason: "Relation confidence is below 0.5 and should be reviewed before relying on it.",
    }));
  const mergeCandidates = findMergeCandidates(options.entities);
  const conflictingRelations = findConflictingRelations(options.relations);
  const pendingItems = options.pending.map((item) => ({ id: item.id, reason: item.reason }));
  const issueCount = orphanEntities.length + lowConfidenceRelations.length + mergeCandidates.length + conflictingRelations.length + pendingItems.length;
  const checked = Math.max(options.entities.length + options.relations.length + options.pending.length, 1);
  const score = Math.max(0, Math.round(100 - (issueCount / checked) * 100));

  return {
    checkedEntities: options.entities.length,
    checkedRelations: options.relations.length,
    orphanEntities,
    lowConfidenceRelations,
    mergeCandidates,
    conflictingRelations,
    pendingItems,
    score,
  };
}

export function planKnowledgeGraphReview(analysis: KnowledgeGraphAnalysis, limit = 10): KnowledgeGraphReviewPlan {
  const suggestions: KnowledgeGraphReviewSuggestion[] = [];

  for (const candidate of analysis.mergeCandidates) {
    suggestions.push({
      action: "merge_entity",
      priority: "high",
      title: `Merge duplicate ${candidate.kind} entities #${candidate.primaryId} <- #${candidate.duplicateId}`,
      reason: `${candidate.primaryName} and ${candidate.duplicateName}: ${candidate.reason}`,
      command: `bestie memory graph merge entity ${candidate.primaryId} ${candidate.duplicateId} --yes`,
      toolCall: { tool: "internal.merge_knowledge_entities", arguments: { primaryId: candidate.primaryId, duplicateId: candidate.duplicateId, reason: candidate.reason } },
    });
  }

  for (const conflict of analysis.conflictingRelations) {
    const id = conflict.relationIds[0];
    suggestions.push({
      action: "inspect_conflict",
      priority: "high",
      title: `Review conflicting relations #${conflict.relationIds.join("/#")}`,
      reason: `${conflict.source} -> ${conflict.target} has ${conflict.types.join(" vs ")}. ${conflict.reason}`,
      command: `bestie memory graph inspect relation ${id}`,
      toolCall: { tool: "internal.analyze_knowledge", arguments: {} },
    });
  }

  for (const pending of analysis.pendingItems) {
    suggestions.push({
      action: "inspect_pending",
      priority: "medium",
      title: `Review pending graph item #${pending.id}`,
      reason: pending.reason ?? "Pending graph item needs owner review before storage.",
      command: `bestie memory graph pending inspect ${pending.id}`,
    });
  }

  for (const relation of analysis.lowConfidenceRelations) {
    suggestions.push({
      action: "inspect_low_confidence",
      priority: "medium",
      title: `Inspect low-confidence relation #${relation.id}`,
      reason: `${relation.relation}: ${relation.reason}`,
      command: `bestie memory graph inspect relation ${relation.id}`,
    });
  }

  for (const entity of analysis.orphanEntities) {
    suggestions.push({
      action: "inspect_orphan",
      priority: "low",
      title: `Inspect orphan ${entity.kind} entity #${entity.id}`,
      reason: `${entity.name}: ${entity.reason}`,
      command: `bestie memory graph inspect entity ${entity.id}`,
      toolCall: { tool: "internal.inspect_entity", arguments: { id: entity.id } },
    });
  }

  const limitedSuggestions = suggestions.slice(0, Math.max(1, limit));
  return {
    score: analysis.score,
    issueCount: analysis.mergeCandidates.length + analysis.conflictingRelations.length + analysis.pendingItems.length + analysis.lowConfidenceRelations.length + analysis.orphanEntities.length,
    suggestions: limitedSuggestions,
    nextCommand: limitedSuggestions[0]?.command,
  };
}

function findMergeCandidates(entities: KnowledgeEntity[]): KnowledgeGraphAnalysis["mergeCandidates"] {
  const candidates: KnowledgeGraphAnalysis["mergeCandidates"] = [];
  for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex += 1) {
      const left = entities[leftIndex];
      const right = entities[rightIndex];
      if (!left || !right || left.kind !== right.kind) {
        continue;
      }
      const reason = explainMergeCandidate(left, right);
      if (!reason) {
        continue;
      }
      const [primary, duplicate] = left.confidence >= right.confidence ? [left, right] : [right, left];
      candidates.push({
        primaryId: primary.id,
        duplicateId: duplicate.id,
        kind: primary.kind,
        primaryName: primary.canonicalName,
        duplicateName: duplicate.canonicalName,
        reason,
      });
    }
  }
  return candidates.slice(0, 50);
}

function explainMergeCandidate(left: KnowledgeEntity, right: KnowledgeEntity): string | undefined {
  const leftKeys = entityMatchKeys(left);
  const rightKeys = entityMatchKeys(right);
  for (const key of leftKeys) {
    if (rightKeys.has(key)) {
      return key === normalizeEntityKey(left.canonicalName) || key === normalizeEntityKey(right.canonicalName)
        ? "Canonical names normalize to the same value."
        : "Canonical name and alias overlap.";
    }
  }

  const leftCompactKeys = entityCompactMatchKeys(left);
  const rightCompactKeys = entityCompactMatchKeys(right);
  for (const key of leftCompactKeys) {
    if (rightCompactKeys.has(key)) {
      return key === compactEntityKey(left.canonicalName) && key === compactEntityKey(right.canonicalName)
        ? "Canonical names differ only by punctuation or spacing."
        : "Canonical name and alias overlap after punctuation normalization.";
    }
  }
  return undefined;
}

function entityMatchKeys(entity: KnowledgeEntity): Set<string> {
  return new Set([entity.canonicalName, ...entity.aliases].map(normalizeEntityKey).filter(Boolean));
}

function entityCompactMatchKeys(entity: KnowledgeEntity): Set<string> {
  return new Set([entity.canonicalName, ...entity.aliases].map(compactEntityKey).filter(Boolean));
}

function normalizeEntityKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function compactEntityKey(value: string): string {
  return normalizeEntityKey(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function findConflictingRelations(relations: KnowledgeRelationWithEntities[]): KnowledgeGraphAnalysis["conflictingRelations"] {
  const byPair = new Map<string, KnowledgeRelationWithEntities[]>();
  for (const relation of relations) {
    const key = `${relation.sourceEntityId}:${relation.targetEntityId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), relation]);
  }

  const conflicts: KnowledgeGraphAnalysis["conflictingRelations"] = [];
  for (const pairRelations of byPair.values()) {
    const byType = new Map(pairRelations.map((relation) => [relation.relationType, relation]));
    const seen = new Set<string>();
    for (const relation of pairRelations) {
      for (const opposingType of CONFLICTING_RELATION_TYPES.get(relation.relationType) ?? []) {
        const opposing = byType.get(opposingType);
        if (!opposing) {
          continue;
        }
        const ids = [relation.id, opposing.id].sort((left, right) => left - right);
        const key = ids.join(":");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        conflicts.push({
          relationIds: ids,
          source: relation.sourceEntity.canonicalName,
          target: relation.targetEntity.canonicalName,
          types: [relation.relationType, opposing.relationType].sort(),
          reason: "Relation types are likely mutually exclusive and should be reviewed.",
        });
      }
    }
  }
  return conflicts.slice(0, 50);
}
