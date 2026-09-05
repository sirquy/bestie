import { setTimeout as delay } from "node:timers/promises";

export interface RetryOptions {
  maxRetries: number;
  retryDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
  onRetry?: (error: unknown, retryNumber: number) => Promise<void> | void;
}

export async function withRetries<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let retryNumber = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!options.shouldRetry(error) || retryNumber >= options.maxRetries) throw error;
      retryNumber += 1;
      await options.onRetry?.(error, retryNumber);
      if (options.retryDelayMs > 0) await delay(options.retryDelayMs);
    }
  }
}
