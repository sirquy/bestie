export interface ChannelChatActionClient<TAction extends string = string> {
  sendChatAction(chatId: number, action: TAction): Promise<void>;
}

export interface ChannelActivityControllerOptions<TAction extends string = string> {
  client: ChannelChatActionClient<TAction>;
  chatId: number;
  action: TAction;
  refreshMs: number;
  maxConsecutiveFailures?: number;
  cooldownMs?: number;
  setTimer?: typeof setInterval;
  clearTimer?: typeof clearInterval;
  now?: () => number;
}

export interface ChannelActivityController {
  start(): void;
  stop(): void;
  pulse(): Promise<boolean>;
}

export function createChannelActivityController<TAction extends string>({
  client,
  chatId,
  action,
  refreshMs,
  maxConsecutiveFailures = 3,
  cooldownMs = Math.max(refreshMs, 1_000),
  setTimer = setInterval,
  clearTimer = clearInterval,
  now = () => Date.now(),
}: ChannelActivityControllerOptions<TAction>): ChannelActivityController {
  let stopped = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let consecutiveFailures = 0;
  let cooldownUntilMs = 0;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  };

  const pulse = async (): Promise<boolean> => {
    if (stopped || now() < cooldownUntilMs) {
      return false;
    }

    try {
      await client.sendChatAction(chatId, action);
      consecutiveFailures = 0;
      return true;
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        cooldownUntilMs = now() + cooldownMs;
        consecutiveFailures = 0;
      }
      return false;
    }
  };

  return {
    start: () => {
      if (!stopped) {
        return;
      }
      stopped = false;
      timer = setTimer(() => {
        void pulse();
      }, refreshMs);
    },
    stop,
    pulse,
  };
}