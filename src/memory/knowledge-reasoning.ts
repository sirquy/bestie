import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { evaluateKnowledgePayload, isKnowledgeEntityKind } from "./knowledge-policy.js";
import { SqliteMemoryStore, type KnowledgeEntity, type KnowledgeEntityKind, type KnowledgeRelation, type KnowledgeSensitivity, type MemoryScope, type PendingKnowledgeItem } from "./sqlite-store.js";

export type KnowledgeReasoningChatCompletion = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;

export interface KnowledgeReasoningTurn {
  channel: "terminal" | "telegram" | "zalo" | "ui";
  userId?: string;
  sourceMessageId?: string;
  userInput: string;
  assistantText: string;
}

export interface KnowledgeReasoningResult {
  storedEntities: KnowledgeEntity[];
  storedRelations: KnowledgeRelation[];
  pending: PendingKnowledgeItem[];
  skipped: Array<{ item: string; reason: string }>;
}

interface ParsedKnowledgeEntityCandidate {
  name: string;
  kind: KnowledgeEntityKind;
  aliases?: string[];
  sensitivity?: KnowledgeSensitivity;
  scope?: MemoryScope;
  confidence?: number;
}

interface ParsedKnowledgeRelationCandidate {
  sourceName: string;
  sourceKind: KnowledgeEntityKind;
  type: string;
  targetName: string;
  targetKind: KnowledgeEntityKind;
  evidence?: string;
  sensitivity?: KnowledgeSensitivity;
  scope?: MemoryScope;
  confidence?: number;
}

const MAX_REASONED_ENTITIES = 5;
const MAX_REASONED_RELATIONS = 5;
const MIN_KNOWLEDGE_CONFIDENCE = 0.65;

export async function runKnowledgeReasoningPass(options: {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  turn: KnowledgeReasoningTurn;
  chatCompletion: KnowledgeReasoningChatCompletion;
}): Promise<KnowledgeReasoningResult> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    if (store.getMemoryState().paused) {
      return emptyKnowledgeReasoningResult();
    }

    const writePolicy = options.config.memory?.writePolicy;
    if (!writePolicy || writePolicy === "deny") {
      return emptyKnowledgeReasoningResult();
    }

    const response = await options.chatCompletion(options.config, options.apiKey, { messages: buildKnowledgeReasoningMessages(options.turn) });
    const parsed = parseKnowledgeReasoningCandidates(response);
    const sourceMessageId = options.turn.sourceMessageId;
    const entities = parsed.entities
      .filter((entity) => (entity.confidence ?? 1) >= MIN_KNOWLEDGE_CONFIDENCE)
      .slice(0, MAX_REASONED_ENTITIES)
      .map((entity) => ({ ...entity, ...(sourceMessageId === undefined ? {} : { sourceMessageId }) }));
    const relations = parsed.relations
      .filter((relation) => (relation.confidence ?? 1) >= MIN_KNOWLEDGE_CONFIDENCE)
      .slice(0, MAX_REASONED_RELATIONS)
      .map((relation) => ({ ...relation, ...(sourceMessageId === undefined ? {} : { sourceMessageId }) }));
    const result = emptyKnowledgeReasoningResult();

    if (entities.length === 0 && relations.length === 0) {
      return result;
    }

    const sensitivity = maxCandidateSensitivity([...entities, ...relations]);
    const policy = evaluateKnowledgePayload({ entities, relations }, sensitivity, false);
    if (policy.decision === "never" || policy.sensitivity === "secret") {
      result.skipped.push({ item: "knowledge_graph_payload", reason: policy.reason });
      return result;
    }

    const reason = `Reasoned from ${options.turn.channel} conversation. ${policy.reason}`;
    if (writePolicy === "ask" || policy.decision === "pending") {
      result.pending.push(store.addPendingKnowledgeItem({ payload: { entities, relations }, reason, source: `reasoning:${options.turn.channel}`, explicitConsent: false }));
      return result;
    }

    const idsByKey = new Map<string, number>();
    for (const entity of entities) {
      const stored = store.upsertKnowledgeEntity({
        canonicalName: entity.name,
        kind: entity.kind,
        aliases: entity.aliases,
        sensitivity: entity.sensitivity ?? policy.sensitivity,
        scope: entity.scope,
        confidence: entity.confidence,
        sourceMessageId: entity.sourceMessageId,
      });
      result.storedEntities.push(stored);
      idsByKey.set(entityKey(stored.canonicalName, stored.kind), stored.id);
    }

    for (const relation of relations) {
      const sourceEntityId = idsByKey.get(entityKey(relation.sourceName, relation.sourceKind)) ?? store.upsertKnowledgeEntity({ canonicalName: relation.sourceName, kind: relation.sourceKind, sourceMessageId }).id;
      const targetEntityId = idsByKey.get(entityKey(relation.targetName, relation.targetKind)) ?? store.upsertKnowledgeEntity({ canonicalName: relation.targetName, kind: relation.targetKind, sourceMessageId }).id;
      const stored = store.upsertKnowledgeRelation({
        sourceEntityId,
        relationType: relation.type,
        targetEntityId,
        evidence: relation.evidence,
        sensitivity: relation.sensitivity ?? policy.sensitivity,
        scope: relation.scope,
        confidence: relation.confidence,
        sourceMessageId: relation.sourceMessageId,
      });
      if (stored) {
        result.storedRelations.push(stored);
      }
    }

    return result;
  } finally {
    store.close();
  }
}

function buildKnowledgeReasoningMessages(turn: KnowledgeReasoningTurn): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Bestie's knowledge graph reasoning pass.",
        "Extract durable entities and relationships from the latest completed conversation only.",
        "Return only JSON: {\"entities\":[{\"name\":\"...\",\"kind\":\"person|project|preference|tool|skill|topic|organization|location|decision|concept\",\"aliases\":[\"...\"],\"confidence\":0.0}],\"relations\":[{\"sourceName\":\"...\",\"sourceKind\":\"person|project|preference|tool|skill|topic|organization|location|decision|concept\",\"type\":\"prefers|works_on|uses|owns|member_of|located_in|decided|related_to|likes|dislikes|wants|blocked_by|depends_on\",\"targetName\":\"...\",\"targetKind\":\"...\",\"evidence\":\"...\",\"confidence\":0.0}]}",
        "Use empty arrays when there is nothing durable.",
        "Never extract secrets, tokens, passwords, payment data, or one-off emotions.",
        "Prefer compact canonical names and stable relation types.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [`Channel: ${turn.channel}`, turn.userId ? `User id: ${turn.userId}` : undefined, `User: ${turn.userInput}`, `Assistant: ${turn.assistantText}`].filter(Boolean).join("\n"),
    },
  ];
}

function parseKnowledgeReasoningCandidates(text: string): { entities: ParsedKnowledgeEntityCandidate[]; relations: ParsedKnowledgeRelationCandidate[] } {
  const rawJson = extractJsonObject(text.trim());
  if (!rawJson) {
    return { entities: [], relations: [] };
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed)) {
      return { entities: [], relations: [] };
    }
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities.flatMap(parseEntityCandidate) : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations.flatMap(parseRelationCandidate) : [],
    };
  } catch {
    return { entities: [], relations: [] };
  }
}

function parseEntityCandidate(value: unknown): ParsedKnowledgeEntityCandidate[] {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.kind !== "string" || !isKnowledgeEntityKind(value.kind)) {
    return [];
  }
  return [{
    name: value.name.trim(),
    kind: value.kind,
    aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : undefined,
    sensitivity: parseSensitivity(value.sensitivity),
    scope: parseScope(value.scope),
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
  }].filter((entity) => entity.name.length > 0);
}

function parseRelationCandidate(value: unknown): ParsedKnowledgeRelationCandidate[] {
  if (!isRecord(value) || typeof value.sourceName !== "string" || typeof value.sourceKind !== "string" || typeof value.type !== "string" || typeof value.targetName !== "string" || typeof value.targetKind !== "string") {
    return [];
  }
  if (!isKnowledgeEntityKind(value.sourceKind) || !isKnowledgeEntityKind(value.targetKind)) {
    return [];
  }
  return [{
    sourceName: value.sourceName.trim(),
    sourceKind: value.sourceKind,
    type: value.type.trim(),
    targetName: value.targetName.trim(),
    targetKind: value.targetKind,
    evidence: typeof value.evidence === "string" ? value.evidence.trim() : undefined,
    sensitivity: parseSensitivity(value.sensitivity),
    scope: parseScope(value.scope),
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
  }].filter((relation) => relation.sourceName.length > 0 && relation.type.length > 0 && relation.targetName.length > 0);
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const value = fenced?.[1]?.trim() ?? text;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start === -1 || end === -1 || end <= start ? undefined : value.slice(start, end + 1);
}

function emptyKnowledgeReasoningResult(): KnowledgeReasoningResult {
  return { storedEntities: [], storedRelations: [], pending: [], skipped: [] };
}

function entityKey(name: string, kind: KnowledgeEntityKind): string {
  return `${kind}:${name.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;
}

function maxCandidateSensitivity(items: Array<{ sensitivity?: KnowledgeSensitivity }>): KnowledgeSensitivity {
  if (items.some((item) => item.sensitivity === "secret")) return "secret";
  if (items.some((item) => item.sensitivity === "sensitive")) return "sensitive";
  return "normal";
}

function parseSensitivity(value: unknown): KnowledgeSensitivity | undefined {
  return value === "normal" || value === "sensitive" || value === "secret" ? value : undefined;
}

function parseScope(value: unknown): MemoryScope | undefined {
  return value === "core" || value === "project" || value === "session" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
