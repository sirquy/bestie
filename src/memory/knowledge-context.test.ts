import assert from "node:assert/strict";
import test from "node:test";

import { selectRelevantKnowledgeGraph } from "./knowledge-context.js";
import type { KnowledgeEntity, KnowledgeRelationWithEntities, PendingKnowledgeItem } from "./sqlite-store.js";

test("selectRelevantKnowledgeGraph retrieves token matches and prioritizes trusted facts", () => {
  const bestie = entity(1, "Bestie", "project", { confidence: 0.9, sourceMessageId: "ui-chat:1:message:2" });
  const sqlite = entity(2, "SQLite", "tool", { confidence: 0.9, sourceMemoryId: 1 });
  const weak = entity(3, "Bestie Legacy", "project", { confidence: 0.25, updatedAt: "2020-01-01T00:00:00.000Z" });
  const relation = relationFor(1, bestie, sqlite, "depends_on", { confidence: 0.9, sourceMemoryId: 1 });

  const result = selectRelevantKnowledgeGraph(fakeStore({
    "bestie sqlite": { entities: [], relations: [] },
    bestie: { entities: [bestie, weak], relations: [] },
    sqlite: { entities: [sqlite], relations: [relation] },
  }, [bestie, sqlite, weak], [relation]), "Can Bestie use SQLite?");

  assert.deepEqual(result.entities.map((item) => item.id), [sqlite.id, bestie.id]);
  assert.deepEqual(result.relations.map((item) => item.id), [relation.id]);
});

test("selectRelevantKnowledgeGraph excludes conflicting relations from prompt context", () => {
  const user = entity(1, "User", "person", { sourceMemoryId: 1 });
  const bestie = entity(2, "Bestie", "project", { sourceMemoryId: 1 });
  const likes = relationFor(1, user, bestie, "likes", { sourceMemoryId: 1 });
  const dislikes = relationFor(2, user, bestie, "dislikes", { sourceMemoryId: 1 });

  const result = selectRelevantKnowledgeGraph(fakeStore({
    "bestie": { entities: [bestie], relations: [likes, dislikes] },
  }, [user, bestie], [likes, dislikes]), "What does User think about Bestie?");

  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.entities.map((item) => item.id), [bestie.id]);
});

test("selectRelevantKnowledgeGraph defensively excludes secret-marked legacy facts", () => {
  const bestie = entity(1, "Bestie", "project", { sourceMemoryId: 1 });
  const credential = entity(2, "Legacy credential", "tool", { sensitivity: "secret", sourceMemoryId: 1 });
  const relation = relationFor(1, bestie, credential, "uses", { sensitivity: "secret", sourceMemoryId: 1 });

  const result = selectRelevantKnowledgeGraph(fakeStore({
    "bestie credential": { entities: [bestie, credential], relations: [relation] },
    bestie: { entities: [bestie], relations: [relation] },
    credential: { entities: [credential], relations: [relation] },
  }, [bestie, credential], [relation]), "Does Bestie use a credential?");

  assert.deepEqual(result.entities.map((item) => item.id), [bestie.id]);
  assert.deepEqual(result.relations, []);
});

function fakeStore(results: Record<string, { entities: KnowledgeEntity[]; relations: KnowledgeRelationWithEntities[] }>, entities: KnowledgeEntity[], relations: KnowledgeRelationWithEntities[]) {
  return {
    searchKnowledgeGraph(query: string) {
      return { query, ...(results[query] ?? { entities: [], relations: [] }) };
    },
    listKnowledgeEntities() {
      return entities;
    },
    listKnowledgeRelations() {
      return relations;
    },
    listPendingKnowledgeItems(): PendingKnowledgeItem[] {
      return [];
    },
  };
}

function entity(id: number, canonicalName: string, kind: KnowledgeEntity["kind"], overrides: Partial<KnowledgeEntity> = {}): KnowledgeEntity {
  return {
    id,
    canonicalName,
    kind,
    aliases: [],
    sensitivity: "normal",
    scope: "core",
    confidence: 1,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function relationFor(id: number, sourceEntity: KnowledgeEntity, targetEntity: KnowledgeEntity, relationType: string, overrides: Partial<KnowledgeRelationWithEntities> = {}): KnowledgeRelationWithEntities {
  return {
    id,
    sourceEntityId: sourceEntity.id,
    relationType,
    targetEntityId: targetEntity.id,
    sensitivity: "normal",
    scope: "core",
    confidence: 1,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    sourceEntity,
    targetEntity,
    ...overrides,
  };
}
