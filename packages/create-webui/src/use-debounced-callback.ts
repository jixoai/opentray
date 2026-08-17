/**
 * Debounced callback hook for composition parameters.
 *
 * The wizard's icon composition is a heavyweight pipeline: /api/form patch
 * plus a real sharp 1024² render on /api/icon-compose. Continuous controls
 * (the scale slider) must not fire it per input event — they fire on commit:
 * after the value settles for `delayMs`, with the LATEST arguments only
 * (trailing edge, never leading, so a fast drag produces exactly one call).
 */
import * as React from "react";

export const useDebouncedCallback = <Args extends readonly unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): ((...args: Args) => void) & { flush(): void; cancel(): void } => {
  const callbackRef = React.useRef(callback);
  callbackRef.current = callback;

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingArgsRef = React.useRef<Args | undefined>(undefined);

  const flush = React.useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const pending = pendingArgsRef.current;
    pendingArgsRef.current = undefined;
    if (pending !== undefined) {
      callbackRef.current(...pending);
    }
  }, []);

  const cancel = React.useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    pendingArgsRef.current = undefined;
  }, []);

  const schedule = React.useCallback(
    (...args: Args): void => {
      pendingArgsRef.current = args;
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        const pending = pendingArgsRef.current;
        pendingArgsRef.current = undefined;
        if (pending !== undefined) {
          callbackRef.current(...pending);
        }
      }, delayMs);
    },
    [delayMs],
  );

  // Fire pending work on unmount (scale committed but timer not elapsed).
  React.useEffect(() => flush, [flush]);

  const scheduleRef = React.useRef(schedule);
  scheduleRef.current = schedule;
  const stable = React.useCallback(
    (...args: Args): void => {
      scheduleRef.current(...args);
    },
    [],
  ) as ((...args: Args) => void) & { flush(): void; cancel(): void };
  stable.flush = flush;
  stable.cancel = cancel;
  return stable;
};
