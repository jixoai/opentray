export interface ExampleLifecycle {
  readonly wait: Promise<void>;
  clearExitTimer(): void;
  shutdown(): Promise<void>;
}

export interface ExampleLifecycleOptions {
  readonly exitAfterMs?: string | undefined;
  readonly onShutdown: () => void | Promise<void>;
}

export const createExampleLifecycle = ({
  exitAfterMs,
  onShutdown,
}: ExampleLifecycleOptions): ExampleLifecycle => {
  let closed = false;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveWait: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });

  const clearExitTimer = (): void => {
    if (exitTimer === undefined) {
      return;
    }
    clearTimeout(exitTimer);
    exitTimer = undefined;
  };

  const shutdown = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    clearExitTimer();
    await onShutdown();
    resolveWait?.();
  };

  const duration = parsePositiveInteger(exitAfterMs);
  if (duration !== undefined) {
    exitTimer = setTimeout(() => {
      void shutdown();
    }, duration);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }

  return { wait, clearExitTimer, shutdown };
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const duration = Number.parseInt(value, 10);
  return Number.isInteger(duration) && duration > 0 ? duration : undefined;
};
