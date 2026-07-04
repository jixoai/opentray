import type { Rect, TrayBoundsResult } from "@opentray/spec";

import {
  windowGeometryKit,
  type WebviewWindowGeometryCoordinateOrigin,
} from "./window-geometry";

export interface WebviewPlacementPoint {
  x: number;
  y: number;
}

export interface WebviewPlacementScreenDetail {
  id: string;
  label?: string;
  isPrimary?: boolean;
  frame: Rect;
  visibleFrame: Rect;
  scaleFactor?: number;
}

export interface WebviewPlacementScreenDetails {
  currentScreen: WebviewPlacementScreenDetail | null;
  screens: WebviewPlacementScreenDetail[];
  isExtended?: boolean;
  coordinateOrigin?: WebviewWindowGeometryCoordinateOrigin;
}

export interface WebviewPlacementInvalidationSource {
  subscribePlacementInvalidation?(listener: () => void): () => void;
}

export interface WebviewPlacementTrayAuthority
  extends WebviewPlacementInvalidationSource {
  getBounds(): Promise<TrayBoundsResult>;
}

export interface WebviewPlacementScreenAuthority
  extends WebviewPlacementInvalidationSource {
  getScreenDetails(): Promise<WebviewPlacementScreenDetails>;
}

export interface WebviewPlacementCursorAuthority
  extends WebviewPlacementInvalidationSource {
  getPosition(): Promise<WebviewPlacementPoint>;
}

export interface WebviewPlacementWindowEvent<TPayload = unknown> {
  event: string;
  payload: TPayload;
}

export interface WebviewPlacementTarget
  extends WebviewPlacementInvalidationSource {
  moveTo(x: number, y: number): Promise<unknown>;
  resizeTo(width: number, height: number): Promise<unknown>;
  getBounds?(): Promise<Rect>;
  listen?<TPayload = unknown>(
    event: string,
    handler: (event: WebviewPlacementWindowEvent<TPayload> | TPayload) => void
  ): Promise<() => Promise<void>> | (() => void);
}

export type WebviewPlacement =
  | "tray"
  | "cursor"
  | "screen-center"
  | "screen-top"
  | "screen-right"
  | "screen-bottom"
  | "screen-left"
  | "screen-top-left"
  | "screen-top-right"
  | "screen-bottom-left"
  | "screen-bottom-right"
  | "edge"
  | "edge-x"
  | "edge-y"
  | "edge-top"
  | "edge-right"
  | "edge-bottom"
  | "edge-left";

export interface WebviewPlacementKitDependencies {
  tray?: WebviewPlacementTrayAuthority;
  screen?: WebviewPlacementScreenAuthority;
  cursor?: WebviewPlacementCursorAuthority;
}

export interface WebviewPlacementOptions {
  placement: WebviewPlacement;
  width: number;
  height: number;
  placementMargin?: number;
  screenId?: string;
  cursorPoint?: WebviewPlacementPoint;
  fallbackRect?: Rect;
  windowRect?: Rect;
  watchIntervalMs?: number;
  settleMs?: number;
}

export type WebviewPlacementResultKind = "native" | "inferred" | "fallback";

export interface WebviewPlacementResult {
  placement: WebviewPlacement;
  rect: Rect;
  kind: WebviewPlacementResultKind;
  source: string;
  anchorRect: Rect | null;
}

export interface WebviewPlacementWatch {
  readonly target: WebviewPlacementTarget;
  readonly active: boolean;
  readonly paused: boolean;
  readonly latest: WebviewPlacementResult | null;
  update(
    options: Partial<WebviewPlacementOptions>
  ): Promise<WebviewPlacementResult>;
  refresh(): Promise<WebviewPlacementResult>;
  pause(): void;
  resume(): Promise<WebviewPlacementResult>;
  stop(): void;
  unwatch(): void;
}

const DEFAULT_MARGIN = 8;
const DEFAULT_WATCH_INTERVAL_MS = 250;
const DEFAULT_WATCH_SETTLE_MS = 180;
const DEFAULT_FALLBACK_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 };
const activeWatches = new WeakMap<WebviewPlacementTarget, PlacementWatch>();

interface TrayPlacementAnchor {
  rect: Rect;
  kind: WebviewPlacementResultKind;
  source: string;
}

export class WebviewPlacementKit {
  readonly #tray: WebviewPlacementTrayAuthority | undefined;
  readonly #screen: WebviewPlacementScreenAuthority | undefined;
  readonly #cursor: WebviewPlacementCursorAuthority | undefined;
  #lastTrayAnchor: TrayPlacementAnchor | null = null;

  constructor(dependencies: WebviewPlacementKitDependencies = {}) {
    this.#tray = dependencies.tray;
    this.#screen = dependencies.screen;
    this.#cursor = dependencies.cursor;
  }

  async resolve(
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementResult> {
    const normalized = await this.resolveInputs(options);

    // TODO(positionTry): this algorithm is already expressed as anchorBound + windowBound +
    // viewport. Future `positionTry` support should add fallback attempts here instead of
    // inventing separate placement families.
    if (options.placement === "tray") {
      const bounds = await this.#tray?.getBounds();
      const anchor = this.resolveTrayAnchor(bounds, normalized);
      if (anchor) {
        return resolveFromAnchor(
          options.placement,
          anchor.rect,
          normalized,
          {
            kind: anchor.kind,
            source: anchor.source,
          }
        );
      }
      return this.resolveFallback(
        options.placement,
        normalized,
        bounds?.rect
          ? `${bounds.source}->invalid`
          : bounds?.source ?? "tray.unavailable"
      );
    }

    if (options.placement === "cursor") {
      const point = options.cursorPoint ?? (await this.#cursor?.getPosition());
      if (point) {
        const normalizedPoint = windowGeometryKit.normalizePoint(
          point,
          "cursor"
        );
        const anchor = {
          x: normalizedPoint.x,
          y: normalizedPoint.y,
          width: 1,
          height: 1,
        };
        return resolveFromAnchor("cursor", anchor, normalized, {
          kind: "inferred",
          source: options.cursorPoint ? "cursorPoint" : "cursor",
        });
      }
      return this.resolveFallback("cursor", normalized, "cursor.unavailable");
    }

    if (isEdgePlacement(options.placement)) {
      const screen = selectScreen(
        normalized.screenDetails,
        options.screenId,
        normalized.windowRect
      );
      if (screen) {
        return resolveEdgePlacement(
          options.placement,
          screen.visibleFrame,
          normalized
        );
      }
      return this.resolveFallback(
        options.placement,
        normalized,
        "screen.unavailable"
      );
    }

    const screen = selectScreen(
      normalized.screenDetails,
      options.screenId,
      normalized.windowRect
    );
    if (screen) {
      return resolveFromAnchor(
        options.placement,
        anchorForScreenPlacement(
          screen.visibleFrame,
          options.placement,
          normalized.coordinateOrigin
        ),
        { ...normalized, viewport: screen.visibleFrame },
        { kind: "native", source: "screen.visibleFrame" }
      );
    }

    return this.resolveFallback(
      options.placement,
      normalized,
      "screen.unavailable"
    );
  }

  async applyOnce(
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementResult> {
    if (activeWatches.has(target)) {
      throw new Error(
        "cannot applyOnce while a placement watch is active for this target"
      );
    }
    return this.applyOnceInternal(target, options);
  }

  once(
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementResult> {
    return this.applyOnce(target, options);
  }

  async watch(
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementWatch> {
    this.unwatch(target);
    let watch: PlacementWatch;
    watch = new PlacementWatch(this, target, options, () => {
      if (activeWatches.get(target) === watch) {
        activeWatches.delete(target);
      }
    });
    activeWatches.set(target, watch);
    await watch.start();
    return watch;
  }

  apply(
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementWatch> {
    return this.watch(target, options);
  }

  unwatch(target: WebviewPlacementTarget): void {
    activeWatches.get(target)?.stop();
    activeWatches.delete(target);
  }

  private async applyOnceInternal(
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions
  ): Promise<WebviewPlacementResult> {
    const rawTargetRect = options.windowRect ?? (await target.getBounds?.());
    const targetRect = rawTargetRect
      ? windowGeometryKit.normalizeWindowRect(rawTargetRect)
      : undefined;
    const result = await this.resolve({
      ...options,
      ...(targetRect ? { windowRect: targetRect } : {}),
    });
    await applyResolvedPlacement(target, result, targetRect);
    return result;
  }

  subscribePlacementInvalidations(listener: () => void): () => void {
    const unsubscribers = [
      this.#tray?.subscribePlacementInvalidation?.(listener),
      this.#screen?.subscribePlacementInvalidation?.(listener),
      this.#cursor?.subscribePlacementInvalidation?.(listener),
    ].filter(
      (unsubscribe): unsubscribe is () => void =>
        typeof unsubscribe === "function"
    );
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  private async resolveInputs(
    options: WebviewPlacementOptions
  ): Promise<ResolvedPlacementInputs> {
    const size = windowGeometryKit.normalizeSize(options.width, options.height);
    const margin = windowGeometryKit.normalizeMargin(
      options.placementMargin,
      DEFAULT_MARGIN
    );
    const screenDetails = windowGeometryKit.normalizeScreenDetails(
      await this.#screen?.getScreenDetails()
    );
    const fallback = windowGeometryKit.normalizeRect(
      options.fallbackRect ?? DEFAULT_FALLBACK_RECT,
      "fallbackRect"
    );
    const windowRect = options.windowRect
      ? windowGeometryKit.normalizeWindowRect(options.windowRect, "windowRect")
      : {
          x: fallback.x,
          y: fallback.y,
          width: size.width,
          height: size.height,
        };
    const viewport =
      selectScreen(screenDetails, options.screenId, windowRect)?.visibleFrame ??
      null;
    return {
      size,
      margin,
      screenDetails,
      coordinateOrigin: windowGeometryKit.normalizeCoordinateOrigin(
        screenDetails?.coordinateOrigin
      ),
      windowRect,
      viewport,
      fallbackRect: fallback,
    };
  }

  private async resolveFallback(
    placement: WebviewPlacement,
    inputs: ResolvedPlacementInputs,
    unavailableSource: string
  ): Promise<WebviewPlacementResult> {
    const point = await this.#cursor?.getPosition();
    if (point) {
      const normalizedPoint = windowGeometryKit.normalizePoint(point, "cursor");
      const anchor = {
        x: normalizedPoint.x,
        y: normalizedPoint.y,
        width: 1,
        height: 1,
      };
      return resolveFromAnchor("cursor", anchor, inputs, {
        kind: "fallback",
        source: `${unavailableSource}->cursor`,
        placement,
      });
    }

    const screen = selectScreen(
      inputs.screenDetails,
      undefined,
      inputs.windowRect
    );
    if (screen) {
      return resolveFromAnchor(
        "screen-center",
        screen.visibleFrame,
        { ...inputs, viewport: screen.visibleFrame },
        {
          kind: "fallback",
          source: `${unavailableSource}->screen-center`,
          placement,
        }
      );
    }

    return {
      placement,
      rect: {
        x: inputs.fallbackRect.x,
        y: inputs.fallbackRect.y,
        width: inputs.size.width,
        height: inputs.size.height,
      },
      kind: "fallback",
      source: `${unavailableSource}->fallbackRect`,
      anchorRect: inputs.fallbackRect,
    };
  }

  private resolveTrayAnchor(
    bounds: TrayBoundsResult | undefined,
    inputs: ResolvedPlacementInputs
  ): TrayPlacementAnchor | null {
    if (!bounds?.rect) {
      return null;
    }
    const rect = windowGeometryKit.normalizeRect(bounds.rect, "tray.rect");
    if (isUsableTrayAnchor(rect, inputs.screenDetails)) {
      const anchor = {
        rect,
        kind: bounds.kind === "native" ? "native" : "inferred",
        source: bounds.source,
      } satisfies TrayPlacementAnchor;
      this.#lastTrayAnchor = anchor;
      return anchor;
    }
    if (this.#lastTrayAnchor) {
      return {
        ...this.#lastTrayAnchor,
        source: `${bounds.source}->last-good`,
      };
    }
    return null;
  }
}

interface ResolvedPlacementInputs {
  size: { width: number; height: number };
  margin: number;
  screenDetails: WebviewPlacementScreenDetails | undefined;
  coordinateOrigin: WebviewWindowGeometryCoordinateOrigin;
  windowRect: Rect;
  viewport: Rect | null;
  fallbackRect: Rect;
}

class PlacementWatch implements WebviewPlacementWatch {
  readonly target: WebviewPlacementTarget;
  #kit: WebviewPlacementKit;
  #options: WebviewPlacementOptions;
  #active = false;
  #latest: WebviewPlacementResult | null = null;
  #unsubscribers: Array<() => void> = [];
  #interval: ReturnType<typeof setInterval> | undefined;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshing: Promise<WebviewPlacementResult> | undefined;
  #windowRect: Rect | undefined;
  #observedRect: Rect | undefined;
  #interactionActive = false;
  #onStop: () => void;

  constructor(
    kit: WebviewPlacementKit,
    target: WebviewPlacementTarget,
    options: WebviewPlacementOptions,
    onStop: () => void
  ) {
    this.#kit = kit;
    this.target = target;
    this.#options = options;
    this.#windowRect = options.windowRect;
    this.#onStop = onStop;
  }

  get active(): boolean {
    return this.#active;
  }

  get paused(): boolean {
    return this.#interactionActive;
  }

  get latest(): WebviewPlacementResult | null {
    return this.#latest;
  }

  async start(): Promise<void> {
    this.#active = true;
    this.#subscribe();
    this.#startInterval();
    await this.refresh();
  }

  async update(
    options: Partial<WebviewPlacementOptions>
  ): Promise<WebviewPlacementResult> {
    this.#options = { ...this.#options, ...options };
    if (options.windowRect) {
      this.#windowRect = options.windowRect;
    }
    return this.refresh();
  }

  refresh(): Promise<WebviewPlacementResult> {
    if (!this.#active) {
      return Promise.reject(new Error("placement watch is not active"));
    }
    if (this.#interactionActive) {
      return this.#latest
        ? Promise.resolve(this.#latest)
        : Promise.reject(
            new Error("placement watch is paused during native interaction")
          );
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

  resume(): Promise<WebviewPlacementResult> {
    if (!this.#active) {
      return Promise.reject(new Error("placement watch is not active"));
    }
    this.#interactionActive = false;
    this.#startInterval();
    return this.#requestRefresh({ settleObservedRect: false });
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

  async #refresh(options: {
    settleObservedRect: boolean;
  }): Promise<WebviewPlacementResult> {
    const observedRect = await this.#targetBounds();
    this.#assertActive();
    // Native window bounds are the placement authority. User drag/resize owns the live bounds, so
    // only settle placement after the bounds stop changing.
    const previousObservedRect = this.#observedRect;
    const targetRect = observedRect ?? this.#windowRect;
    if (observedRect) {
      this.#observedRect = observedRect;
      this.#windowRect = observedRect;
    }
    const result = await this.#kit.resolve({
      ...this.#optionsForTargetRect(targetRect),
      ...(targetRect ? { windowRect: targetRect } : {}),
    });
    this.#assertActive();
    if (this.#interactionActive) {
      this.#latest = result;
      return result;
    }
    const shouldSettle =
      options.settleObservedRect &&
      this.#shouldSettleObservedRect(observedRect, previousObservedRect);
    if (shouldSettle) {
      this.#latest = result;
      this.#scheduleSettledRefresh();
      return result;
    }
    const currentRect = targetRect ?? this.#latest?.rect;
    if (!currentRect || !windowGeometryKit.sameRect(currentRect, result.rect)) {
      await applyResolvedPlacement(this.target, result, currentRect, {
        resize: false,
      });
      this.#assertActive();
    }
    this.#latest = result;
    this.#windowRect = result.rect;
    this.#observedRect = result.rect;
    return result;
  }

  #subscribe(): void {
    this.#pushUnsubscribe(
      this.#kit.subscribePlacementInvalidations(() =>
        this.#requestBackgroundRefresh()
      )
    );
    this.#pushUnsubscribe(
      this.target.subscribePlacementInvalidation?.(() =>
        this.#requestBackgroundRefresh()
      )
    );
    this.#subscribeTargetEvent("moved");
    this.#subscribeTargetEvent("resized");
    this.#subscribeInteractionEvent();
    this.#subscribeLifecycleEvent("closed");
    this.#subscribeLifecycleEvent("hidden");
    this.#subscribeLifecycleEvent("windowstatechange");
  }

  #subscribeTargetEvent(event: "moved" | "resized"): void {
    const unlisten = this.target.listen?.(event, (payload) => {
      this.#windowRect = mergeWindowEventRect(
        this.#windowRect ?? this.#latest?.rect,
        event,
        payload
      );
      if (this.#interactionActive) {
        return;
      }
      this.#requestBackgroundRefresh();
    });
    this.#trackUnlisten(unlisten);
  }

  #subscribeLifecycleEvent(
    event: "closed" | "hidden" | "windowstatechange"
  ): void {
    const unlisten = this.target.listen?.(event, (payload) => {
      if (shouldStopForLifecycleEvent(event, payload)) {
        this.stop();
      }
    });
    this.#trackUnlisten(unlisten);
  }

  #subscribeInteractionEvent(): void {
    const unlisten = this.target.listen?.(
      "windowinteractionchange",
      (payload) => {
        const active = readInteractionActive(payload);
        if (active === null) {
          return;
        }
        if (active) {
          this.pause();
          return;
        }
        this.#resumeInBackground();
      }
    );
    this.#trackUnlisten(unlisten);
  }

  #trackUnlisten(
    unlisten:
      | ReturnType<NonNullable<WebviewPlacementTarget["listen"]>>
      | undefined
  ): void {
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

  #pushUnsubscribe(unsubscribe: (() => void) | undefined): void {
    if (unsubscribe) {
      this.#unsubscribers.push(unsubscribe);
    }
  }

  #requestRefresh(
    options: { settleObservedRect: boolean } = { settleObservedRect: true }
  ): Promise<WebviewPlacementResult> {
    if (!this.#active) {
      return Promise.reject(new Error("placement watch is not active"));
    }
    if (this.#interactionActive) {
      return this.#latest
        ? Promise.resolve(this.#latest)
        : Promise.reject(
            new Error("placement watch is paused during native interaction")
          );
    }
    this.#refreshing ??= this.#refresh(options).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  #requestBackgroundRefresh(
    options: { settleObservedRect: boolean } = { settleObservedRect: true }
  ): void {
    void this.#requestRefresh(options).catch((error: unknown) => {
      if (this.#active) {
        console.error("WebviewPlacementKit background refresh failed:", error);
      }
    });
  }

  #resumeInBackground(): void {
    void this.resume().catch((error: unknown) => {
      if (this.#active) {
        console.error("WebviewPlacementKit background resume failed:", error);
      }
    });
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error("placement watch stopped");
    }
  }

  #startInterval(): void {
    if (
      this.#interval !== undefined ||
      !this.#active ||
      this.#interactionActive
    ) {
      return;
    }
    this.#interval = setInterval(() => {
      this.#requestBackgroundRefresh();
    }, normalizeWatchInterval(this.#options.watchIntervalMs));
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
    }, normalizeSettleMs(this.#options.settleMs));
  }

  #shouldSettleObservedRect(
    observedRect: Rect | undefined,
    previousObservedRect: Rect | undefined
  ): boolean {
    if (!observedRect || !previousObservedRect) {
      return false;
    }
    return !windowGeometryKit.sameRect(observedRect, previousObservedRect);
  }

  #optionsForTargetRect(targetRect: Rect | undefined): WebviewPlacementOptions {
    if (!targetRect) {
      return this.#options;
    }
    return {
      ...this.#options,
      width: targetRect.width,
      height: targetRect.height,
    };
  }

  async #targetBounds(): Promise<Rect | undefined> {
    const bounds = await this.target.getBounds?.();
    return bounds ? windowGeometryKit.normalizeWindowRect(bounds) : undefined;
  }
}

const normalizeWatchInterval = (interval: number | undefined): number =>
  Math.max(
    16,
    Math.round(
      finiteNumber(interval ?? DEFAULT_WATCH_INTERVAL_MS, "watchIntervalMs")
    )
  );

const normalizeSettleMs = (interval: number | undefined): number =>
  Math.max(
    0,
    Math.round(finiteNumber(interval ?? DEFAULT_WATCH_SETTLE_MS, "settleMs"))
  );

const finiteNumber = (value: number, name: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const selectScreen = (
  details: WebviewPlacementScreenDetails | undefined,
  screenId: string | undefined,
  anchor: Rect | null
): WebviewPlacementScreenDetail | null =>
  windowGeometryKit.selectScreen(details, screenId, anchor);

const isUsableTrayAnchor = (
  rect: Rect,
  details: WebviewPlacementScreenDetails | undefined
): boolean => {
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  if (!details || details.screens.length === 0) {
    return true;
  }
  const center = windowGeometryKit.rectCenter(rect);
  return details.screens.some(
    (screen) =>
      windowGeometryKit.containsPoint(screen.visibleFrame, center) ||
      windowGeometryKit.containsPoint(screen.frame, center)
  );
};

const resolveFromAnchor = (
  requestedPlacement: WebviewPlacement,
  anchor: Rect,
  inputs: ResolvedPlacementInputs,
  provenance: {
    kind: WebviewPlacementResultKind;
    source: string;
    placement?: WebviewPlacement;
  }
): WebviewPlacementResult => {
  const rect = rectForAnchor(anchor, requestedPlacement, inputs);
  return {
    placement: provenance.placement ?? requestedPlacement,
    rect: inputs.viewport
      ? windowGeometryKit.clampRect(rect, inputs.viewport)
      : rect,
    kind: provenance.kind,
    source: provenance.source,
    anchorRect: anchor,
  };
};

const anchorForScreenPlacement = (
  frame: Rect,
  placement: WebviewPlacement,
  origin: WebviewWindowGeometryCoordinateOrigin
): Rect => {
  const top = visualTopY(frame, origin);
  const bottom = visualBottomY(frame, origin);
  switch (placement) {
    case "screen-top":
      return { x: frame.x, y: top, width: frame.width, height: 0 };
    case "screen-right":
      return {
        x: frame.x + frame.width,
        y: frame.y,
        width: 0,
        height: frame.height,
      };
    case "screen-bottom":
      return { x: frame.x, y: bottom, width: frame.width, height: 0 };
    case "screen-left":
      return { x: frame.x, y: frame.y, width: 0, height: frame.height };
    case "screen-top-left":
      return { x: frame.x, y: top, width: 0, height: 0 };
    case "screen-top-right":
      return { x: frame.x + frame.width, y: top, width: 0, height: 0 };
    case "screen-bottom-left":
      return { x: frame.x, y: bottom, width: 0, height: 0 };
    case "screen-bottom-right":
      return { x: frame.x + frame.width, y: bottom, width: 0, height: 0 };
    case "screen-center":
    case "tray":
    case "cursor":
    case "edge":
    case "edge-x":
    case "edge-y":
    case "edge-top":
    case "edge-right":
    case "edge-bottom":
    case "edge-left":
      return frame;
  }
};

const rectForAnchor = (
  anchor: Rect,
  placement: WebviewPlacement,
  inputs: ResolvedPlacementInputs
): Rect => {
  const { size, margin, coordinateOrigin } = inputs;
  switch (placement) {
    case "cursor":
      return rect(
        anchor.x + margin,
        yBelowPoint(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-center":
      return rect(
        anchor.x + (anchor.width - size.width) / 2,
        anchor.y + (anchor.height - size.height) / 2,
        size
      );
    case "screen-top":
      return rect(
        anchor.x + (anchor.width - size.width) / 2,
        yNearTop(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-right":
      return rect(
        anchor.x - size.width - margin,
        anchor.y + (anchor.height - size.height) / 2,
        size
      );
    case "screen-bottom":
      return rect(
        anchor.x + (anchor.width - size.width) / 2,
        yNearBottom(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-left":
      return rect(
        anchor.x + margin,
        anchor.y + (anchor.height - size.height) / 2,
        size
      );
    case "screen-top-left":
      return rect(
        anchor.x + margin,
        yNearTop(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-top-right":
      return rect(
        anchor.x - size.width - margin,
        yNearTop(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-bottom-left":
      return rect(
        anchor.x + margin,
        yNearBottom(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "screen-bottom-right":
      return rect(
        anchor.x - size.width - margin,
        yNearBottom(anchor.y, size.height, margin, coordinateOrigin),
        size
      );
    case "tray":
      return rectForTrayAnchor(anchor, inputs);
    case "edge":
    case "edge-x":
    case "edge-y":
    case "edge-top":
    case "edge-right":
    case "edge-bottom":
    case "edge-left":
      return rect(
        anchor.x + (anchor.width - size.width) / 2,
        yBelowRect(anchor, size.height, margin, coordinateOrigin),
        size
      );
  }
};

const rectForTrayAnchor = (
  anchor: Rect,
  inputs: ResolvedPlacementInputs
): Rect => {
  const { size, margin, viewport, coordinateOrigin } = inputs;
  const centeredX = anchor.x + (anchor.width - size.width) / 2;
  const above = rect(
    centeredX,
    yAboveRect(anchor, size.height, margin, coordinateOrigin),
    size
  );
  const below = rect(
    centeredX,
    yBelowRect(anchor, size.height, margin, coordinateOrigin),
    size
  );
  if (!viewport) {
    return above;
  }
  const aboveFits = windowGeometryKit.fitsRect(above, viewport);
  const belowFits = windowGeometryKit.fitsRect(below, viewport);
  if (aboveFits && !belowFits) {
    return above;
  }
  if (belowFits && !aboveFits) {
    return below;
  }
  const anchorInTopHalf = isInVisualTopHalf(anchor, viewport, coordinateOrigin);
  if (aboveFits && belowFits) {
    return anchorInTopHalf ? below : above;
  }
  return anchorInTopHalf ? below : above;
};

const isEdgePlacement = (placement: WebviewPlacement): boolean =>
  placement.startsWith("edge");

const resolveEdgePlacement = (
  placement: WebviewPlacement,
  viewport: Rect,
  inputs: ResolvedPlacementInputs
): WebviewPlacementResult => {
  const edge = edgeForPlacement(
    placement,
    inputs.windowRect,
    viewport,
    inputs.coordinateOrigin
  );
  const anchor = anchorForEdge(viewport, edge, inputs.coordinateOrigin);
  const rect = rectForEdge(
    edge,
    viewport,
    inputs.windowRect,
    inputs.size,
    inputs.margin,
    inputs.coordinateOrigin
  );
  return {
    placement,
    rect: windowGeometryKit.clampRect(rect, viewport),
    kind: "native",
    source: `edge.${edge}`,
    anchorRect: anchor,
  };
};

type Edge = "top" | "right" | "bottom" | "left";

const edgeForPlacement = (
  placement: WebviewPlacement,
  windowRect: Rect,
  viewport: Rect,
  origin: WebviewWindowGeometryCoordinateOrigin
): Edge => {
  switch (placement) {
    case "edge-top":
      return "top";
    case "edge-right":
      return "right";
    case "edge-bottom":
      return "bottom";
    case "edge-left":
      return "left";
    case "edge-x":
      return nearestEdge(windowRect, viewport, ["left", "right"]);
    case "edge-y":
      return nearestEdge(windowRect, viewport, ["top", "bottom"], origin);
    case "edge":
      return nearestEdge(
        windowRect,
        viewport,
        ["top", "right", "bottom", "left"],
        origin
      );
    default:
      throw new Error(`${placement} is not an edge placement`);
  }
};

const nearestEdge = (
  windowRect: Rect,
  viewport: Rect,
  candidates: Edge[],
  origin: WebviewWindowGeometryCoordinateOrigin = "topLeft"
): Edge => {
  const center = windowGeometryKit.rectCenter(windowRect);
  const distances: Record<Edge, number> = {
    top: Math.abs(center.y - visualTopY(viewport, origin)),
    right: Math.abs(viewport.x + viewport.width - center.x),
    bottom: Math.abs(visualBottomY(viewport, origin) - center.y),
    left: Math.abs(center.x - viewport.x),
  };
  return candidates.reduce(
    (best, edge) => (distances[edge] < distances[best] ? edge : best),
    candidates[0] ?? "right"
  );
};

const anchorForEdge = (
  viewport: Rect,
  edge: Edge,
  origin: WebviewWindowGeometryCoordinateOrigin
): Rect => {
  switch (edge) {
    case "top":
      return {
        x: viewport.x,
        y: visualTopY(viewport, origin),
        width: viewport.width,
        height: 0,
      };
    case "right":
      return {
        x: viewport.x + viewport.width,
        y: viewport.y,
        width: 0,
        height: viewport.height,
      };
    case "bottom":
      return {
        x: viewport.x,
        y: visualBottomY(viewport, origin),
        width: viewport.width,
        height: 0,
      };
    case "left":
      return {
        x: viewport.x,
        y: viewport.y,
        width: 0,
        height: viewport.height,
      };
  }
};

const rectForEdge = (
  edge: Edge,
  viewport: Rect,
  windowRect: Rect,
  size: { width: number; height: number },
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): Rect => {
  const center = windowGeometryKit.rectCenter(windowRect);
  switch (edge) {
    case "top":
      return rect(
        center.x - size.width / 2,
        yNearTop(visualTopY(viewport, origin), size.height, margin, origin),
        size
      );
    case "right":
      return rect(
        viewport.x + viewport.width - size.width - margin,
        center.y - size.height / 2,
        size
      );
    case "bottom":
      return rect(
        center.x - size.width / 2,
        yNearBottom(
          visualBottomY(viewport, origin),
          size.height,
          margin,
          origin
        ),
        size
      );
    case "left":
      return rect(viewport.x + margin, center.y - size.height / 2, size);
  }
};

const visualTopY = (
  rect: Rect,
  origin: WebviewWindowGeometryCoordinateOrigin
): number => (origin === "bottomLeft" ? rect.y + rect.height : rect.y);

const visualBottomY = (
  rect: Rect,
  origin: WebviewWindowGeometryCoordinateOrigin
): number => (origin === "bottomLeft" ? rect.y : rect.y + rect.height);

const yNearTop = (
  visualTop: number,
  height: number,
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): number =>
  origin === "bottomLeft" ? visualTop - height - margin : visualTop + margin;

const yNearBottom = (
  visualBottom: number,
  height: number,
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): number =>
  origin === "bottomLeft"
    ? visualBottom + margin
    : visualBottom - height - margin;

const yAboveRect = (
  anchor: Rect,
  height: number,
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): number =>
  origin === "bottomLeft"
    ? visualTopY(anchor, origin) + margin
    : visualTopY(anchor, origin) - height - margin;

const yBelowPoint = (
  pointY: number,
  height: number,
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): number =>
  origin === "bottomLeft" ? pointY - height - margin : pointY + margin;

const yBelowRect = (
  anchor: Rect,
  height: number,
  margin: number,
  origin: WebviewWindowGeometryCoordinateOrigin
): number =>
  origin === "bottomLeft"
    ? visualBottomY(anchor, origin) - height - margin
    : visualBottomY(anchor, origin) + margin;

const isInVisualTopHalf = (
  anchor: Rect,
  viewport: Rect,
  origin: WebviewWindowGeometryCoordinateOrigin
): boolean => {
  const anchorCenterY = windowGeometryKit.rectCenter(anchor).y;
  const viewportCenterY = windowGeometryKit.rectCenter(viewport).y;
  return origin === "bottomLeft"
    ? anchorCenterY > viewportCenterY
    : anchorCenterY < viewportCenterY;
};

const rect = (
  x: number,
  y: number,
  size: { width: number; height: number }
): Rect => ({
  x: Math.round(x),
  y: Math.round(y),
  width: size.width,
  height: size.height,
});

const mergeWindowEventRect = (
  current: Rect | undefined,
  event: "moved" | "resized",
  rawPayload: unknown
): Rect | undefined => {
  const payload = unwrapWindowEventPayload(rawPayload);
  if (event === "moved" && hasNumber(payload, "x") && hasNumber(payload, "y")) {
    const point = windowGeometryKit.normalizePoint(payload, "moved");
    return {
      x: point.x,
      y: point.y,
      width: current?.width ?? 1,
      height: current?.height ?? 1,
    };
  }
  if (
    event === "resized" &&
    hasNumber(payload, "width") &&
    hasNumber(payload, "height")
  ) {
    const size = windowGeometryKit.normalizeSize(payload.width, payload.height);
    return {
      x: current?.x ?? 0,
      y: current?.y ?? 0,
      width: size.width,
      height: size.height,
    };
  }
  return current;
};

const unwrapWindowEventPayload = (event: unknown): unknown => {
  if (event && typeof event === "object" && "payload" in event) {
    return (event as { payload: unknown }).payload;
  }
  return event;
};

const hasNumber = <TKey extends string>(
  value: unknown,
  key: TKey
): value is Record<TKey, number> =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<TKey, unknown>)[key] === "number"
  );

const shouldStopForLifecycleEvent = (
  event: string,
  rawPayload: unknown
): boolean => {
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

const hasBoolean = <TKey extends string>(
  value: unknown,
  key: TKey
): value is Record<TKey, boolean> =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<TKey, unknown>)[key] === "boolean"
  );

const applyResolvedPlacement = async (
  target: WebviewPlacementTarget,
  result: WebviewPlacementResult,
  currentRect?: Rect,
  options: { resize: boolean } = { resize: true }
): Promise<void> => {
  await windowGeometryKit.applyRect(target, result.rect, currentRect, options);
};
