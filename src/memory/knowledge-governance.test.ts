import assert from "node:assert/strict";
import test from "node:test";

import { analyzeKnowledgeGraph, planKnowledgeGraphReview } from "./knowledge-governance.js";
import type { KnowledgeEntity, KnowledgeRelationWithEntities } from "./sqlite-store.js";

test("analyzeKnowledgeGraph reports merge candidates and relation conflicts", () => {
  const user = entity(1, "User", "person");
  const bestie = entity(2, "Bestie", "project", ["Bestie Agent"]);
  const duplicateBestie = entity(3, "bestie-agent", "project");
  const likes = relation(1, user, bestie, "likes");
  const dislikes = relation(2, user, bestie, "dislikes");

  const analysis = analyzeKnowledgeGraph({
    entities: [user, bestie, duplicateBestie],
    relations: [likes, dislikes],
    pending: [],
  });

  assert.deepEqual(analysis.mergeCandidates, [{
    primaryId: 2,
    duplicateId: 3,
    kind: "project",
    primaryName: "Bestie",
    duplicateName: "bestie-agent",
    reason: "Canonical name and alias overlap after punctuation normalization.",
  }]);
  assert.deepEqual(analysis.conflictingRelations, [{
    relationIds: [1, 2],
    source: "User",
    target: "Bestie",
    types: ["dislikes", "likes"],
    reason: "Relation types are likely mutually exclusive and should be reviewed.",
  }]);
  assert.equal(analysis.score < 100, true);

  const plan = planKnowledgeGraphReview(analysis, 2);
  assert.equal(plan.issueCount, 3);
  assert.deepEqual(plan.suggestions.map((suggestion) => suggestion.action), ["merge_entity", "inspect_conflict"]);
  assert.equal(plan.nextCommand, "bestie memory graph merge entity 2 3 --yes");
  assert.deepEqual(plan.suggestions[0]?.toolCall, { tool: "internal.merge_knowledge_entities", arguments: { primaryId: 2, duplicateId: 3, reason: "Canonical name and alias overlap after punctuation normalization." } });
});

function entity(id: number, canonicalName: string, kind: KnowledgeEntity["kind"], aliases: string[] = []): KnowledgeEntity {
  return {
    id,
    canonicalName,
    kind,
    aliases,
    sensitivity: "normal",
    scope: "core",
    confidence: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function relation(id: number, sourceEntity: KnowledgeEntity, targetEntity: KnowledgeEntity, relationType: string): KnowledgeRelationWithEntities {
  return {
    id,
    sourceEntityId: sourceEntity.id,
    relationType,
    targetEntityId: targetEntity.id,
    sensitivity: "normal",
    scope: "core",
    confidence: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceEntity,
    targetEntity,
  };
}
