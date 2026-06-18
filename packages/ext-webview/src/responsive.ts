import type { Rect } from "@opentray/spec";

import type {
  WebviewBackgroundEffectState,
  WebviewBackgroundOptions,
  WebviewWindowBackgroundInput,
  WebviewWindowSizeConstraintValue,
  WebviewWindowStyle,
  WebviewWindowStylePatch,
} from "./index";
import { windowGeometryKit } from "./window-geometry";

export interface WebviewStyleKitTarget {
  resizeTo(width: number, height: number): Promise<unknown>;
  setMinimumSize(width?: WebviewWindowSizeConstraintValue, height?: WebviewWindowSizeConstraintValue): Promise<unknown>;
  setMaximumSize(width?: WebviewWindowSizeConstraintValue, height?: WebviewWindowSizeConstraintValue): Promise<unknown>;
  setStyle?(style: WebviewWindowStylePatch): Promise<WebviewWindowStyle>;
  setBackground?(background: WebviewWindowBackgroundInput, options?: WebviewBackgroundOptions): Promise<WebviewWindowStyle>;
}

export interface WebviewWindowStyleRecipe {
  initWidth?: number;
  initHeight?: number;
  minWidth?: WebviewWindowSizeConstraintValue;
  minHeight?: WebviewWindowSizeConstraintValue;
  maxWidth?: WebviewWindowSizeConstraintValue;
  maxHeight?: WebviewWindowSizeConstraintValue;
  aspectRatio?: number;
  background?: WebviewWindowBackgroundInput;
  state?: WebviewBackgroundEffectState;
  frameless?: boolean;
  keepOnTop?: boolean;
  platform?: WebviewWindowStylePatch["platform"];
}

export interface WebviewMediaQueryTarget {
  getBounds(): Promise<Rect>;
  listen?<TPayload = unknown>(
    event: string,
    handler: (event: { event: string; payload: TPayload } | TPayload) => void,
  ): (() => void) | Promise<() => Promise<void>>;
}

export interface WebviewMediaQuery {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface WebviewMediaQueryContext {
  bounds: Rect;
  media: WebviewMediaQuery;
  matches: boolean;
}

export type WebviewMediaQueryCallback<TTarget extends WebviewMediaQueryTarget> = (
  target: TTarget,
  context: WebviewMediaQueryContext,
) => void | Promise<void>;

export type WebviewMediaQueryRule<TTarget extends WebviewMediaQueryTarget = WebviewMediaQueryTarget> =
  WebviewMediaQuery & {
    callback: WebviewMediaQueryCallback<TTarget>;
  };

export type WebviewMediaQueryInput<TTarget extends WebviewMediaQueryTarget> =
  | WebviewMediaQuery
  | WebviewMediaQueryCallback<TTarget>
  | WebviewMediaQueryRule<TTarget>;

export interface WebviewMediaQueryWatch {
  readonly active: boolean;
  readonly paused: boolean;
  refresh(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  stop(): void;
  unwatch(): void;
}

const DEFAULT_MEDIA_QUERY_INTERVAL_MS = 250;
const DEFAULT_MEDIA_QUERY_SETTLE_MS = 180;
const activeMediaQueryWatches = new WeakMap<WebviewMediaQueryTarget, WebviewMediaQueryWatch>();

export const styleKit = {
  gen<TTarget extends WebviewStyleKitTarget>(style: WebviewWindowStyleRecipe): (target: TTarget) => Promise<void> {
    return (target) => styleKit.apply(target, style);
  },

  async apply<TTarget extends WebviewStyleKitTarget>(target: TTarget, style: WebviewWindowStyleRecipe): Promise<void> {
    const size = initialSizeFromStyle(style);
    if (style.minWidth !== undefined || style.minHeight !== undefined) {
      await target.setMinimumSize(style.minWidth, style.minHeight);
    }
    if (style.maxWidth !== undefined || style.maxHeight !== undefined) {
      await target.setMaximumSize(style.maxWidth, style.maxHeight);
    }
    if (size) {
      await target.resizeTo(size.width, size.height);
    }
    const patch = stylePatchFromRecipe(style);
    if (patch) {
      await target.setStyle?.(patch);
    }
    if (style.background !== undefined) {
      await target.setBackground?.(style.background, backgroundOptionsFromStyle(style));
    }
  },
};

export const mediaQueryKit = {
  async match<TTarget extends WebviewMediaQueryTarget>(
    target: TTarget,
    ...inputs: WebviewMediaQueryInput<TTarget>[]
  ): Promise<WebviewMediaQueryWatch> {
    const rules = normalizeMediaQueryRules(inputs);
    activeMediaQueryWatches.get(target)?.stop();
    const watch = new MediaQueryWatch(target, rules, () => {
      if (activeMediaQueryWatches.get(target) === watch) {
        activeMediaQueryWatches.delete(target);
      }
    });
    activeMediaQueryWatches.set(target, watch);
    await watch.start();
    return watch;
  },
};

const initialSizeFromStyle = (style: WebviewWindowStyleRecipe): { width: number; height: number } | null => {
  const width = positiveFiniteOptional(style.initWidth, "initWidth");
  const explicitHeight = positiveFiniteOptional(style.initHeight, "initHeight");
  const aspectRatio = positiveFiniteOptional(style.aspectRatio, "aspectRatio");
  const height = explicitHeight ?? (width !== undefined && aspectRatio !== undefined ? width / aspectRatio : undefined);
  if (width === undefined || height === undefined) {
    return null;
  }
  return windowGeometryKit.normalizeSize(width, height);
};

const stylePatchFromRecipe = (style: WebviewWindowStyleRecipe): WebviewWindowStylePatch | null => {
  const patch: WebviewWindowStylePatch = {
    ...(style.frameless === undefined ? {} : { frameless: style.frameless }),
    ...(style.keepOnTop === undefined ? {} : { keepOnTop: style.keepOnTop }),
    ...(style.platform === undefined ? {} : { platform: style.platform }),
  };
  return Object.keys(patch).length === 0 ? null : patch;
};

const backgroundOptionsFromStyle = (style: WebviewWindowStyleRecipe): WebviewBackgroundOptions | undefined =>
  style.state === undefined ? undefined : { state: style.state };

const positiveFiniteOptional = (value: number | undefined, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return value;
};

const normalizeMediaQueryRules = <TTarget extends WebviewMediaQueryTarget>(
  inputs: WebviewMediaQueryInput<TTarget>[],
): WebviewMediaQueryRule<TTarget>[] => {
  const rules: WebviewMediaQueryRule<TTarget>[] = [];
  let pending: WebviewMediaQuery | undefined;
  for (const input of inputs) {
    if (typeof input === "function") {
      if (pending === undefined) {
        throw new Error("mediaQueryKit.match callback must follow a media query object");
      }
      rules.push({ ...pending, callback: input });
      pending = undefined;
      continue;
    }
    if (isMediaQueryRule(input)) {
      if (pending !== undefined) {
        throw new Error("mediaQueryKit.match media query is missing a callback");
      }
      rules.push(input);
      continue;
    }
    if (pending !== undefined) {
      throw new Error("mediaQueryKit.match media query is missing a callback");
    }
    validateMediaQuery(input);
    pending = input;
  }
  if (pending !== undefined) {
    throw new Error("mediaQueryKit.match media query is missing a callback");
  }
  if (rules.length === 0) {
    throw new Error("mediaQueryKit.match requires at least one rule");
  }
  return rules;
};

const isMediaQueryRule = <TTarget extends WebviewMediaQueryTarget>(
  input: WebviewMediaQueryInput<TTarget>,
): input is WebviewMediaQueryRule<TTarget> =>
  typeof input === "object" && input !== null && "callback" in input && typeof input.callback === "function";

const validateMediaQuery = (query: WebviewMediaQuery): void => {
  positiveFiniteOptional(query.minWidth, "minWidth");
  positiveFiniteOptional(query.maxWidth, "maxWidth");
  positiveFiniteOptional(query.minHeight, "minHeight");
  positiveFiniteOptional(query.maxHeight, "maxHeight");
};

class MediaQueryWatch<TTarget extends WebviewMediaQueryTarget> implements WebviewMediaQueryWatch {
  readonly #target: TTarget;
  readonly #rules: WebviewMediaQueryRule<TTarget>[];
  readonly #onStop: () => void;
  #active = false;
  #interval: ReturnType<typeof setInterval> | undefined;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshing: Promise<void> | undefined;
  #unsubscribers: Array<() => void> = [];
  #observedBounds: Rect | undefined;
  #interactionActive = false;
  #lastMatches = new Map<WebviewMediaQueryRule<TTarget>, boolean>();

  constructor(target: TTarget, rules: WebviewMediaQueryRule<TTarget>[], onStop: () => void) {
    this.#target = target;
    this.#rules = rules;
    this.#onStop = onStop;
  }

  get active(): boolean {
    return this.#active;
  }

  get paused(): boolean {
    return this.#interactionActive;
  }

  async start(): Promise<void> {
    this.#active = true;
    this.#subscribeTargetEvent("resized");
    this.#subscribeInteractionEvent();
    this.#subscribeLifecycleEvent("closed");
    this.#subscribeLifecycleEvent("hidden");
    this.#subscribeLifecycleEvent("windowstatechange");
    this.#startInterval();
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.#active) {
      return Promise.reject(new Error("media query watch is not active"));
    }
    if (this.#interactionActive) {
      return Promise.resolve();
    }
    return this.#requestRefresh();
  }

  pause(): void {
    if (!this.#active) {
      return;
    }
    this.#interactionActive = true;
    this.#stopInterval();
    if (this.#settleTimer !== undefined) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = undefined;
    }
  }

  resume(): Promise<void> {
    if (!this.#active) {
      return Promise.reject(new Error("media query watch is not active"));
    }
    this.#interactionActive = false;
    this.#startInterval();
    return this.#requestRefresh({ settleObservedBounds: false });
  }

  stop(): void {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    if (this.#interval !== undefined) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
    if (this.#settleTimer !== undefined) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = undefined;
    }
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.#onStop();
  }

  unwatch(): void {
    this.stop();
  }

  async #refresh(options: { settleObservedBounds: boolean }): Promise<void> {
    const bounds = windowGeometryKit.normalizeWindowRect(await this.#target.getBounds());
    this.#assertActive();
    // Bounds are already normalized to desktop logical pixels by the native boundary; do not do DPI correction here.
    // Defer callback-driven window adjustments until the current resize/move settles.
    const previousBounds = this.#observedBounds;
    if (
      this.#interactionActive ||
      (options.settleObservedBounds && this.#shouldSettleBounds(bounds, previousBounds))
    ) {
      this.#observedBounds = bounds;
      if (!this.#interactionActive) {
        this.#scheduleSettledRefresh();
      }
      return;
    }
    this.#observedBounds = bounds;
    for (const rule of this.#rules) {
      const matches = matchesMediaQuery(bounds, rule);
      if (this.#lastMatches.get(rule) === matches) {
        continue;
      }
      this.#lastMatches.set(rule, matches);
      if (matches) {
        await rule.callback(this.#target, { bounds, media: rule, matches });
        this.#assertActive();
      }
    }
  }

  #subscribeTargetEvent(event: string): void {
    const unlisten = this.#target.listen?.(event, () => {
      if (this.#interactionActive) {
        return;
      }
      this.#requestBackgroundRefresh();
    });
    this.#trackUnlisten(unlisten);
  }

  #subscribeLifecycleEvent(event: "closed" | "hidden" | "windowstatechange"): void {
    const unlisten = this.#target.listen?.(event, (payload) => {
      if (shouldStopForLifecycleEvent(event, payload)) {
        this.stop();
      }
    });
    this.#trackUnlisten(unlisten);
  }

  #subscribeInteractionEvent(): void {
    const unlisten = this.#target.listen?.("windowinteractionchange", (payload) => {
      const active = readInteractionActive(payload);
      if (active === null) {
        return;
      }
      if (active) {
        this.pause();
        return;
      }
      this.#resumeInBackground();
    });
    this.#trackUnlisten(unlisten);
  }

  #trackUnlisten(unlisten: ReturnType<NonNullable<WebviewMediaQueryTarget["listen"]>> | undefined): void {
    if (typeof unlisten === "function") {
      this.#unsubscribers.push(unlisten);
      return;
    }
    if (unlisten) {
      let active = true;
      void unlisten.then((resolved) => {
        if (active) {
          this.#unsubscribers.push(() => void resolved());
        } else {
          void resolved();
        }
      });
      this.#unsubscribers.push(() => {
        active = false;
      });
    }
  }

  #requestRefresh(options: { settleObservedBounds: boolean } = { settleObservedBounds: true }): Promise<void> {
    if (!this.#active) {
      return Promise.reject(new Error("media query watch is not active"));
    }
    if (this.#interactionActive) {
      return Promise.resolve();
    }
    this.#refreshing ??= this.#refresh(options).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  #requestBackgroundRefresh(options: { settleObservedBounds: boolean } = { settleObservedBounds: true }): void {
    void this.#requestRefresh(options).catch((error: unknown) => {
      if (this.#active) {
        console.error("mediaQueryKit background refresh failed:", error);
      }
    });
  }

  #resumeInBackground(): void {
    void this.resume().catch((error: unknown) => {
      if (this.#active) {
        console.error("mediaQueryKit background resume failed:", error);
      }
    });
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error("media query watch stopped");
    }
  }

  #startInterval(): void {
    if (this.#interval !== undefined || !this.#active || this.#interactionActive) {
      return;
    }
    this.#interval = setInterval(() => {
      this.#requestBackgroundRefresh();
    }, DEFAULT_MEDIA_QUERY_INTERVAL_MS);
  }

  #stopInterval(): void {
    if (this.#interval !== undefined) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
  }

  #scheduleSettledRefresh(): void {
    if (!this.#active) {
      return;
    }
    if (this.#interactionActive) {
      return;
    }
    if (this.#settleTimer !== undefined) {
      clearTimeout(this.#settleTimer);
    }
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      this.#requestBackgroundRefresh();
    }, DEFAULT_MEDIA_QUERY_SETTLE_MS);
  }

  #shouldSettleBounds(bounds: Rect, previousBounds: Rect | undefined): boolean {
    return previousBounds !== undefined && !windowGeometryKit.sameRect(bounds, previousBounds);
  }
}

const matchesMediaQuery = (bounds: Rect, query: WebviewMediaQuery): boolean =>
  (query.minWidth === undefined || bounds.width >= query.minWidth) &&
  (query.maxWidth === undefined || bounds.width <= query.maxWidth) &&
  (query.minHeight === undefined || bounds.height >= query.minHeight) &&
  (query.maxHeight === undefined || bounds.height <= query.maxHeight);

const shouldStopForLifecycleEvent = (event: string, rawPayload: unknown): boolean => {
  if (event === "closed" || event === "hidden") {
    return true;
  }
  const payload = unwrapWindowEventPayload(rawPayload);
  return hasBoolean(payload, "visible") && !payload.visible;
};

const readInteractionActive = (rawPayload: unknown): boolean | null => {
  const payload = unwrapWindowEventPayload(rawPayload);
  return hasBoolean(payload, "active") ? payload.active : null;
};

const unwrapWindowEventPayload = (event: unknown): unknown => {
  if (event && typeof event === "object" && "payload" in event) {
    return (event as { payload: unknown }).payload;
  }
  return event;
};

const hasBoolean = <TKey extends string>(value: unknown, key: TKey): value is Record<TKey, boolean> =>
  Boolean(value && typeof value === "object" && typeof (value as Record<TKey, unknown>)[key] === "boolean");
