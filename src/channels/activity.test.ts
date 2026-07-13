import assert from "node:assert/strict";
import test from "node:test";

import { createChannelActivityController } from "./activity.js";

test("channel activity controller sends repeated chat actions until stopped", async () => {
  const calls: Array<{ chatId: number; action: string }> = [];
  const controller = createChannelActivityController({
    client: {
      sendChatAction: async (chatId, action) => {
        calls.push({ chatId, action });
      },
    },
    chatId: 777,
    action: "typing",
    refreshMs: 100,
  });

  controller.start();
  assert.equal(await controller.pulse(), true);
  controller.stop();
  assert.equal(await controller.pulse(), false);

  assert.deepEqual(calls, [{ chatId: 777, action: "typing" }]);
});

test("channel activity controller cools down after repeated action failures", async () => {
  let nowMs = 1_000;
  let calls = 0;
  const controller = createChannelActivityController({
    client: {
      sendChatAction: async () => {
        calls += 1;
        throw new Error("rate limited");
      },
    },
    chatId: 777,
    action: "typing",
    refreshMs: 100,
    maxConsecutiveFailures: 2,
    cooldownMs: 500,
    now: () => nowMs,
  });

  controller.start();
  assert.equal(await controller.pulse(), false);
  assert.equal(await controller.pulse(), false);
  assert.equal(await controller.pulse(), false);
  assert.equal(calls, 2);

  nowMs = 1_501;
  assert.equal(await controller.pulse(), false);
  assert.equal(calls, 3);
  controller.stop();
});