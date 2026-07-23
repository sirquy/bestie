import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeTrustMetrics, compareKnowledgeTrustPriority, formatKnowledgeTrustFlags, knowledgeTrustSourceKind, summarizeKnowledgeTrust } from "./knowledge-trust.js";

test("knowledge trust classifies source kinds consistently", () => {
  assert.equal(knowledgeTrustSourceKind({ sourceMemoryId: 7 }), "memory");
  assert.equal(knowledgeTrustSourceKind({ sourceMessageId: "ui-chat:1:message:2:run:3" }), "ui_chat");
  assert.equal(knowledgeTrustSourceKind({ sourceMessageId: "telegram:42" }), "message");
  assert.equal(knowledgeTrustSourceKind({}), "manual");
});

test("knowledge trust metrics reward sourced current facts and flag stale weak facts", () => {
  const trusted = buildKnowledgeTrustMetrics({
    confidence: 0.95,
    updatedAt: new Date().toISOString(),
    sourceMessageId: "ui-chat:1:message:2:run:3",
    relationCount: 3,
    auditTrail: [{ eventType: "created" }, { eventType: "updated" }],
  });
  const weak = buildKnowledgeTrustMetrics({
    confidence: 0.25,
    updatedAt: "2020-01-01T00:00:00.000Z",
  });

  assert.equal(trusted.level, "high");
  assert.equal(trusted.sourceKind, "ui_chat");
  assert.equal(trusted.needsSource, false);
  assert.equal(weak.level, "low");
  assert.equal(weak.needsSource, true);
  assert.equal(weak.stale, true);
  assert.match(weak.warnings.join(" / "), /Needs stronger source attribution/);
});

test("knowledge trust helpers format prompt flags and summarize scores", () => {
  const high = { confidence: 0.9, updatedAt: new Date().toISOString(), sourceMemoryId: 1 };
  const low = { confidence: 0.2, updatedAt: "2020-01-01T00:00:00.000Z" };

  assert.match(formatKnowledgeTrustFlags(high), /trust:high:/);
  assert.match(formatKnowledgeTrustFlags(low), /trust:low:.*stale, use cautiously/);
  assert.equal(compareKnowledgeTrustPriority(high, low) < 0, true);

  const summary = summarizeKnowledgeTrust([buildKnowledgeTrustMetrics(high), buildKnowledgeTrustMetrics(low)]);
  assert.equal(summary.highTrust, 1);
  assert.equal(summary.lowTrust, 1);
  assert.equal(summary.needsSource, 1);
});
