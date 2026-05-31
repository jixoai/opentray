export type LeaseId = string;
export type SurfaceId = string;
export type TrayId = string;
export type MenuItemId = number;

export interface SurfaceOptions {
  appId: string;
  title?: string;
  icon?: Icon;
  default?: boolean;
}

export interface SurfaceRef {
  surfaceId: SurfaceId;
  appId: string;
}

export interface TrayOptions {
  trayId?: TrayId;
  appId?: string;
  title?: string;
  tooltip?: Tooltip;
  icon: Icon;
  menu?: Menu;
}

export interface Tooltip {
  title: string;
  description: string;
}

export interface Menu {
  items: MenuItem[];
}

export type MenuItem =
  | {
      type: "item";
      id: MenuItemId;
      title: string;
      enabled?: boolean;
      shortcut?: string;
    }
  | {
      type: "check";
      id: MenuItemId;
      title: string;
      enabled?: boolean;
      checked?: boolean;
    }
  | {
      type: "radio";
      id: MenuItemId;
      title: string;
      enabled?: boolean;
      checked?: boolean;
      group: number;
    }
  | {
      type: "separator";
    }
  | {
      type: "submenu";
      title: string;
      enabled?: boolean;
      items: MenuItem[];
    };

export type Icon =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MouseButton = "left" | "right" | "middle";

export type TrayEvent =
  | { type: "ready"; surfaceId: SurfaceId }
  | { type: "menuClick"; surfaceId: SurfaceId; trayId: TrayId; itemId: MenuItemId }
  | { type: "trayClick"; surfaceId: SurfaceId; button: MouseButton; x: number; y: number }
  | { type: "trayDoubleClick"; surfaceId: SurfaceId; button: MouseButton; x: number; y: number };

export interface ExtensionScope {
  surfaceId: SurfaceId;
  trayId?: TrayId;
  ext: string;
}

export interface ExtensionEnvelope<TData = unknown> {
  scope: ExtensionScope;
  data: TData;
}

export type ClientFrame =
  | { type: "init"; version: number }
  | ({ type: "create-surface" } & SurfaceOptions)
  | { type: "resolve-default-surface" }
  | { type: "create-tray"; surface: SurfaceRef; tray: TrayOptions }
  | { type: "destroy-tray"; surfaceId: SurfaceId; trayId: TrayId }
  | { type: "set-tray-menu"; surfaceId: SurfaceId; trayId: TrayId; menu: Menu }
  | { type: "set-tray-icon"; surfaceId: SurfaceId; trayId: TrayId; icon: Icon }
  | { type: "set-tray-tooltip"; surfaceId: SurfaceId; trayId: TrayId; tooltip: Tooltip }
  | { type: "load-ext"; surfaceId: SurfaceId; name: string; path: string }
  | { type: "ext-command"; surfaceId: SurfaceId; trayId: TrayId; ext: string; data: unknown }
  | { type: "unload-ext"; surfaceId: SurfaceId; name: string }
  | { type: "exit" };

export type ServerFrame =
  | { type: "ready"; version: number }
  | { type: "surface-created"; surface: SurfaceRef }
  | { type: "default-surface"; surface: SurfaceRef }
  | { type: "tray-created"; surfaceId: SurfaceId; trayId: TrayId }
  | { type: "event"; event: TrayEvent }
  | { type: "ext-event"; surfaceId: SurfaceId; trayId: TrayId; ext: string; data: unknown }
  | { type: "error"; message: string };

export interface ParseResult<T> {
  ok: boolean;
  frame?: T;
  error?: string;
}

export const parseServerFrame = (line: string): ParseResult<ServerFrame> => {
  try {
    const value: unknown = JSON.parse(line);
    if (!isServerFrame(value)) {
      return { ok: false, error: "invalid server frame" };
    }
    return { ok: true, frame: value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown parse error",
    };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isServerFrame = (value: unknown): value is ServerFrame =>
  isRecord(value) && typeof value.type === "string";
