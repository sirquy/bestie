export type KnowledgeTrustSourceKind = "memory" | "ui_chat" | "message" | "manual";

export interface KnowledgeTrustAuditEventLike {
  eventType: string;
}

export interface KnowledgeTrustItemLike {
  confidence: number;
  updatedAt: string;
  sourceMemoryId?: number;
  sourceMessageId?: string;
}

export interface KnowledgeTrustMetrics {
  score: number;
  level: "high" | "medium" | "low";
  ageDays: number;
  sourceKind: KnowledgeTrustSourceKind;
  sourceQuality: number;
  relationCount?: number;
  confirmationCount: number;
  needsSource: boolean;
  stale: boolean;
  conflicting: boolean;
  signals: string[];
  warnings: string[];
}

export interface KnowledgeTrustSummary {
  averageScore: number;
  highTrust: number;
  mediumTrust: number;
  lowTrust: number;
  stale: number;
  needsSource: number;
  conflicting: number;
}

export interface KnowledgeTrustOptions extends KnowledgeTrustItemLike {
  sourceKind?: KnowledgeTrustSourceKind;
  auditTrail?: KnowledgeTrustAuditEventLike[];
  relationCount?: number;
  conflicting?: boolean;
}

export function buildKnowledgeTrustMetrics(options: KnowledgeTrustOptions): KnowledgeTrustMetrics {
  const sourceKind = options.sourceKind ?? knowledgeTrustSourceKind(options);
  const ageDays = knowledgeAgeDays(options.updatedAt);
  const stale = ageDays > 90;
  const needsSource = sourceKind === "manual" || sourceKind === "message";
  const sourceQuality = knowledgeSourceTrustQuality(sourceKind);
  const confirmationCount = (options.auditTrail ?? []).filter((event) => ["created", "updated", "approved"].includes(event.eventType)).length;
  const recencyScore = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.82 : ageDays <= 90 ? 0.62 : 0.35;
  const relationSupport = options.relationCount === undefined ? 0.04 : Math.min(0.08, options.relationCount * 0.025);
  const confirmationBoost = Math.min(0.06, confirmationCount * 0.02);
  let score = options.confidence * 0.62 + sourceQuality * 0.18 + recencyScore * 0.1 + relationSupport + confirmationBoost;
  if (needsSource) score -= 0.12;
  if (stale) score -= 0.08;
  if (options.conflicting) score -= 0.24;
  score = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const warnings = [
    score < 55 ? "Low trust score" : undefined,
    needsSource ? "Needs stronger source attribution" : undefined,
    stale ? "Stale update age" : undefined,
    options.conflicting ? "Conflicting relation" : undefined,
  ].filter((value): value is string => Boolean(value));
  const signals = [
    `Confidence ${Math.round(options.confidence * 100)}%`,
    `Source ${sourceKind}`,
    `${ageDays} day${ageDays === 1 ? "" : "s"} old`,
    options.relationCount === undefined ? undefined : `${options.relationCount} relation${options.relationCount === 1 ? "" : "s"}`,
    confirmationCount ? `${confirmationCount} audit confirmation${confirmationCount === 1 ? "" : "s"}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    score,
    level: score >= 75 ? "high" : score >= 55 ? "medium" : "low",
    ageDays,
    sourceKind,
    sourceQuality: Math.round(sourceQuality * 100),
    ...(options.relationCount === undefined ? {} : { relationCount: options.relationCount }),
    confirmationCount,
    needsSource,
    stale,
    conflicting: Boolean(options.conflicting),
    signals,
    warnings,
  };
}

export function summarizeKnowledgeTrust(metrics: KnowledgeTrustMetrics[]): KnowledgeTrustSummary {
  const averageScore = metrics.length ? Math.round(metrics.reduce((total, item) => total + item.score, 0) / metrics.length) : 100;
  return {
    averageScore,
    highTrust: metrics.filter((item) => item.level === "high").length,
    mediumTrust: metrics.filter((item) => item.level === "medium").length,
    lowTrust: metrics.filter((item) => item.level === "low").length,
    stale: metrics.filter((item) => item.stale).length,
    needsSource: metrics.filter((item) => item.needsSource).length,
    conflicting: metrics.filter((item) => item.conflicting).length,
  };
}

export function compareKnowledgeTrustPriority(left: KnowledgeTrustItemLike, right: KnowledgeTrustItemLike): number {
  const trust = knowledgeTrustScore(right) - knowledgeTrustScore(left);
  if (trust !== 0) return trust;

  const confidence = right.confidence - left.confidence;
  if (confidence !== 0) return confidence;

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function formatKnowledgeTrustFlags(item: KnowledgeTrustItemLike): string {
  const metrics = buildKnowledgeTrustMetrics(item);
  const flags = [
    `trust:${metrics.level}:${metrics.score}`,
    `confidence:${item.confidence}`,
    `source:${metrics.sourceKind}`,
    metrics.stale ? "stale" : undefined,
    metrics.score < 55 ? "use cautiously" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return flags.join(", ");
}

export function knowledgeTrustScore(item: KnowledgeTrustItemLike): number {
  return buildKnowledgeTrustMetrics(item).score;
}

export function knowledgeTrustSourceKind(item: { sourceMemoryId?: number; sourceMessageId?: string }): KnowledgeTrustSourceKind {
  if (item.sourceMemoryId !== undefined) return "memory";
  if (item.sourceMessageId?.startsWith("ui-chat:")) return "ui_chat";
  if (item.sourceMessageId !== undefined) return "message";
  return "manual";
}

export function knowledgeSourceTrustQuality(kind: KnowledgeTrustSourceKind): number {
  if (kind === "memory") return 0.9;
  if (kind === "ui_chat") return 0.86;
  if (kind === "message") return 0.62;
  return 0.42;
}

export function knowledgeAgeDays(value: string): number {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}
