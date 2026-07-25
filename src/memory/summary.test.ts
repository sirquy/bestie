import assert from "node:assert/strict";
import test from "node:test";

import { formatMemorySummary } from "./summary.js";

test("formatMemorySummary reports rolling conversation summary continuity", () => {
  const output = formatMemorySummary({
    memories: [],
    plan: {
      allowed: true,
      reason: "test",
      checked: 0,
      deleteIds: [],
      duplicateGroups: [],
      staleMemories: [],
      conflictGroups: [],
      reviewOnlyIds: [],
    },
    rebalance: { checked: 0, recommendations: [], reviewOnlyIds: [] },
    conversationSummaries: [
      { id: 1, channel: "telegram", userId: "123", content: "Earlier Telegram context", summarizedMessageId: 12, updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, channel: "ui", userId: "session:7", content: "Earlier UI context", summarizedMessageId: 8, updatedAt: "2026-01-02T00:00:00.000Z" },
    ],
    deletePolicy: "ask",
    retrievalPolicy: "full",
  });

  assert.match(output, /\[Continuity\]/);
  assert.match(output, /Rolling summaries: 2/);
  assert.match(output, /Channels: telegram:1, ui:1/);
  assert.match(output, /Latest: ui:session:7 updated 2026-01-02T00:00:00.000Z, through message #8/);
});

