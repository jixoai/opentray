import type { Rect } from "@opentray/spec";

export const WINDOW_GEOMETRY_UNIT = "desktopLogicalPixels";

export type WebviewWindowGeometryCoordinateOrigin = "topLeft" | "bottomLeft";

export interface WebviewWindowGeometryPoint {
  x: number;
  y: number;
}

export interface WebviewWindowGeometrySize {
  width: number;
  height: number;
}

export interface WebviewWindowGeometryScreenDetail {
  id: string;
  label?: string;
  isPrimary?: boolean;
  frame: Rect;
  visibleFrame: Rect;
  scaleFactor?: number;
}

export interface WebviewWindowGeometryScreenDetails {
  currentScreen: WebviewWindowGeometryScreenDetail | null;
  screens: WebviewWindowGeometryScreenDetail[];
  isExtended?: boolean;
  coordinateOrigin?: WebviewWindowGeometryCoordinateOrigin;
}

export interface WebviewWindowGeometryTarget {
  moveTo(x: number, y: number): Promise<unknown>;
  resizeTo(width: number, height: number): Promise<unknown>;
}

export interface WebviewWindowGeometryApplyOptions {
  resize?: boolean;
}

// Native boundaries normalize OpenTray window, screen, and tray geometry to desktop logical
// pixels. Browser CSS pixels, devicePixelRatio, and overlay titlebar CSS conversion are separate
// coordinate systems and must not be mixed into backend placement math.
export const windowGeometryKit = {
  unit: WINDOW_GEOMETRY_UNIT,

  normalizePoint(
    point: WebviewWindowGeometryPoint,
    name = "point"
  ): WebviewWindowGeometryPoint {
    return {
      x: Math.round(finiteNumber(point.x, `${name}.x`)),
      y: Math.round(finiteNumber(point.y, `${name}.y`)),
    };
  },

  normalizeSize(width: number, height: number): WebviewWindowGeometrySize {
    return {
      width: Math.max(1, Math.round(finiteNumber(width, "width"))),
      height: Math.max(1, Math.round(finiteNumber(height, "height"))),
    };
  },

  normalizeRect(rect: Rect, name = "rect"): Rect {
    return {
      x: Math.round(finiteNumber(rect.x, `${name}.x`)),
      y: Math.round(finiteNumber(rect.y, `${name}.y`)),
      width: Math.max(0, Math.round(finiteNumber(rect.width, `${name}.width`))),
      height: Math.max(
        0,
        Math.round(finiteNumber(rect.height, `${name}.height`))
      ),
    };
  },

  normalizeWindowRect(rect: Rect, name = "windowRect"): Rect {
    const normalized = this.normalizeRect(rect, name);
    return {
      ...normalized,
      width: Math.max(1, normalized.width),
      height: Math.max(1, normalized.height),
    };
  },

  normalizeMargin(margin: number | undefined, fallback: number): number {
    return Math.max(
      0,
      Math.round(finiteNumber(margin ?? fallback, "placementMargin"))
    );
  },

  normalizeCoordinateOrigin(
    origin: WebviewWindowGeometryCoordinateOrigin | undefined
  ): WebviewWindowGeometryCoordinateOrigin {
    return origin === "bottomLeft" ? "bottomLeft" : "topLeft";
  },

  normalizeScreenDetails(
    details: WebviewWindowGeometryScreenDetails | undefined
  ): WebviewWindowGeometryScreenDetails | undefined {
    if (!details) {
      return undefined;
    }
    const screens = details.screens.map((screen) =>
      normalizeScreenDetail(screen)
    );
    const currentScreen = details.currentScreen
      ? screens.find((screen) => screen.id === details.currentScreen?.id) ??
        normalizeScreenDetail(details.currentScreen)
      : null;
    return {
      currentScreen,
      screens,
      ...(details.isExtended === undefined
        ? {}
        : { isExtended: details.isExtended }),
      coordinateOrigin: this.normalizeCoordinateOrigin(
        details.coordinateOrigin
      ),
    };
  },

  selectScreen(
    details: WebviewWindowGeometryScreenDetails | undefined,
    screenId: string | undefined,
    anchor: Rect | null
  ): WebviewWindowGeometryScreenDetail | null {
    if (!details || details.screens.length === 0) {
      return null;
    }
    if (screenId) {
      return (
        details.screens.find((screen) => screen.id === screenId) ??
        details.currentScreen ??
        details.screens[0] ??
        null
      );
    }
    if (anchor) {
      const point = this.rectCenter(anchor);
      const containing = details.screens.find((screen) =>
        this.containsPoint(screen.visibleFrame, point)
      );
      if (containing) {
        return containing;
      }
    }
    return details.currentScreen ?? details.screens[0] ?? null;
  },

  containsPoint(rect: Rect, point: WebviewWindowGeometryPoint): boolean {
    return (
      point.x >= rect.x &&
      point.y >= rect.y &&
      point.x <= rect.x + rect.width &&
      point.y <= rect.y + rect.height
    );
  },

  rectCenter(rect: Rect): WebviewWindowGeometryPoint {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  },

  fitsRect(candidate: Rect, bounds: Rect): boolean {
    return (
      candidate.x >= bounds.x &&
      candidate.y >= bounds.y &&
      candidate.x + candidate.width <= bounds.x + bounds.width &&
      candidate.y + candidate.height <= bounds.y + bounds.height
    );
  },

  clampRect(candidate: Rect, bounds: Rect): Rect {
    const maxX = Math.max(bounds.x, bounds.x + bounds.width - candidate.width);
    const maxY = Math.max(
      bounds.y,
      bounds.y + bounds.height - candidate.height
    );
    return {
      x: Math.min(Math.max(candidate.x, bounds.x), maxX),
      y: Math.min(Math.max(candidate.y, bounds.y), maxY),
      width: candidate.width,
      height: candidate.height,
    };
  },

  samePosition(left: Rect, right: Rect): boolean {
    return left.x === right.x && left.y === right.y;
  },

  sameSize(left: Rect, right: Rect): boolean {
    return left.width === right.width && left.height === right.height;
  },

  sameRect(left: Rect, right: Rect): boolean {
    return this.samePosition(left, right) && this.sameSize(left, right);
  },

  async applyRect(
    target: WebviewWindowGeometryTarget,
    rect: Rect,
    currentRect?: Rect,
    options: WebviewWindowGeometryApplyOptions = {}
  ): Promise<void> {
    const shouldResize = options.resize ?? true;
    if (shouldResize && (!currentRect || !this.sameSize(currentRect, rect))) {
      await target.resizeTo(rect.width, rect.height);
    }
    if (!currentRect || !this.samePosition(currentRect, rect)) {
      await target.moveTo(rect.x, rect.y);
    }
  },
};

const normalizeScreenDetail = (
  screen: WebviewWindowGeometryScreenDetail
): WebviewWindowGeometryScreenDetail => ({
  id: screen.id,
  ...(screen.label === undefined ? {} : { label: screen.label }),
  ...(screen.isPrimary === undefined ? {} : { isPrimary: screen.isPrimary }),
  frame: windowGeometryKit.normalizeRect(screen.frame, `${screen.id}.frame`),
  visibleFrame: windowGeometryKit.normalizeRect(
    screen.visibleFrame,
    `${screen.id}.visibleFrame`
  ),
  ...(screen.scaleFactor === undefined
    ? {}
    : {
        scaleFactor: finiteNumber(
          screen.scaleFactor,
          `${screen.id}.scaleFactor`
        ),
      }),
});

const finiteNumber = (value: number, name: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};
