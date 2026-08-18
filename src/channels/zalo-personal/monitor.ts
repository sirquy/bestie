import type { AppConfig } from "../../runtime/config.js";
import { appendLog } from "../../runtime/logger.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { handleZaloUpdate, type ZaloChatCompletionRunner } from "../zalo.js";
import { ZaloPersonalClient, type ZaloPersonalInboundMessage } from "./client.js";

export interface ZaloPersonalMonitorOptions {
  config: AppConfig;
  paths: RuntimePaths;
  createClient: () => Promise<ZaloPersonalClient>;
  shouldStop?: () => boolean;
  chatCompletion?: ZaloChatCompletionRunner;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function runZaloPersonalMonitor(options: ZaloPersonalMonitorOptions): Promise<void> {
  const reconnect = options.config.channels?.zaloPersonal?.reconnect;
  const initialDelayMs = reconnect?.initialDelayMs ?? 1_000;
  const maxDelayMs = reconnect?.maxDelayMs ?? 30_000;
  const seen = new Set<string>();
  const queues = new Map<string, Promise<void>>();
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let failures = 0;

  while (!options.shouldStop?.()) {
    let detach: (() => void) | undefined;
    let failed = false;
    let closed!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });

    try {
      const client = await options.createClient();
      detach = client.startListening({
        onMessage: (message) => {
          const update = client.toUpdate(message);
          if (!update) return;
          const key = inboundKey(message);
          if (seen.has(key)) return;
          seen.add(key);
          if (seen.size > 5_000) seen.delete(seen.values().next().value ?? key);
          const threadQueue = queues.get(message.threadId) ?? Promise.resolve();
          const next = threadQueue
            .then(async () => { await handleZaloUpdate(update, { config: options.config, paths: options.paths, client, chatCompletion: options.chatCompletion, channel: "zalo-personal" }); })
            .catch(async (error) => {
              await appendLog({ event: "zalo_personal_message_failure", detail: { message: error instanceof Error ? error.message : "Unknown message failure." } }, { paths: options.paths });
            })
            .finally(() => {
              if (queues.get(message.threadId) === next) queues.delete(message.threadId);
            });
          queues.set(message.threadId, next);
        },
        onError: (error) => {
          void appendLog({ event: "zalo_personal_listener_error", detail: { message: error instanceof Error ? error.message : "Unknown listener error." } }, { paths: options.paths });
          closed();
        },
        onClosed: closed,
      });
      failures = 0;
      await waitForStopOrClose(closedPromise, options.shouldStop, sleep);
    } catch (error) {
      failed = true;
      failures += 1;
      await appendLog({ event: "zalo_personal_listener_failure", detail: { message: error instanceof Error ? error.message : "Unknown listener failure.", failures } }, { paths: options.paths });
    } finally {
      detach?.();
    }

    if (options.shouldStop?.()) break;
    if (!failed) failures += 1;
    const delayMs = Math.min(initialDelayMs * 2 ** Math.min(failures - 1, 8), maxDelayMs);
    await sleep(delayMs);
  }
}

async function waitForStopOrClose(closed: Promise<void>, shouldStop: (() => boolean) | undefined, sleep: (milliseconds: number) => Promise<void>): Promise<void> {
  while (!shouldStop?.()) {
    const result = await Promise.race([closed.then(() => true), sleep(250).then(() => false)]);
    if (result) return;
  }
}

function inboundKey(message: ZaloPersonalInboundMessage): string {
  return `${message.threadId}:${message.data.msgId ?? message.data.cliMsgId ?? message.data.ts ?? "unknown"}`;
}
