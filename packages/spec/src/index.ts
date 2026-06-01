export type LeaseId = string;
export type RequestId = string;
export type SurfaceId = string;
export type TrayId = string;
export type MenuItemId = number;

export const PROTOCOL_VERSION = 1;

export interface BrokerEndpointIdentity {
  packageVersion: string;
  protocolVersion: number;
}

export interface BrokerEndpointIdentityOptions {
  packageVersion: string;
  protocolVersion?: number;
}

export const createBrokerEndpointIdentity = ({
  packageVersion,
  protocolVersion = PROTOCOL_VERSION,
}: BrokerEndpointIdentityOptions): BrokerEndpointIdentity => {
  assertEndpointComponent(packageVersion, "packageVersion");
  if (!Number.isInteger(protocolVersion) || protocolVersion <= 0) {
    throw new Error(`protocolVersion must be a positive integer: ${protocolVersion}`);
  }

  return {
    packageVersion,
    protocolVersion,
  };
};

export const isSupportedProtocolVersion = (protocolVersion: number): boolean =>
  protocolVersion === PROTOCOL_VERSION;

export const formatBrokerEndpointName = (identity: BrokerEndpointIdentity): string => {
  assertEndpointIdentity(identity);
  return `opentray-${identity.packageVersion}-p${identity.protocolVersion}`;
};

export const formatBrokerStateRoot = (homeDir: string, identity: BrokerEndpointIdentity): string => {
  assertEndpointIdentity(identity);
  if (homeDir.length === 0) {
    throw new Error("homeDir must not be empty");
  }

  const normalizedHome = homeDir.replace(/[\\/]+$/u, "");
  return `${normalizedHome}/.opentray/${identity.packageVersion}`;
};

export const formatUnixSocketPath = (homeDir: string, identity: BrokerEndpointIdentity): string =>
  `${formatBrokerStateRoot(homeDir, identity)}/opentray-p${identity.protocolVersion}.sock`;

export const formatWindowsPipeName = (identity: BrokerEndpointIdentity): string =>
  `\\\\.\\pipe\\${formatBrokerEndpointName(identity)}`;

const endpointComponentPattern = /^[0-9A-Za-z._+-]+$/u;

const assertEndpointIdentity = (identity: BrokerEndpointIdentity): void => {
  assertEndpointComponent(identity.packageVersion, "packageVersion");
  if (!Number.isInteger(identity.protocolVersion) || identity.protocolVersion <= 0) {
    throw new Error(`protocolVersion must be a positive integer: ${identity.protocolVersion}`);
  }
};

const assertEndpointComponent = (value: string, name: string): void => {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (!endpointComponentPattern.test(value)) {
    throw new Error(`${name} contains invalid endpoint characters: ${value}`);
  }
};

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
  | { type: "init"; protocolVersion: number; clientVersion: string }
  | ClientRequestFrame
  | { type: "exit" };

export type ClientRequestFrame =
  | ({ type: "create-surface"; requestId: RequestId } & SurfaceOptions)
  | { type: "resolve-default-surface"; requestId: RequestId }
  | { type: "create-tray"; requestId: RequestId; surface: SurfaceRef; tray: TrayOptions }
  | { type: "destroy-tray"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId }
  | { type: "set-tray-menu"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId; menu: Menu }
  | { type: "set-tray-icon"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId; icon: Icon }
  | { type: "set-tray-tooltip"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId; tooltip: Tooltip }
  | { type: "load-ext"; requestId: RequestId; surfaceId: SurfaceId; name: string; path: string }
  | { type: "ext-command"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId; ext: string; data: unknown }
  | { type: "unload-ext"; requestId: RequestId; surfaceId: SurfaceId; name: string };

export type ServerFrame =
  | { type: "ready"; protocolVersion: number; brokerVersion: string; leaseId: LeaseId }
  | { type: "surface-created"; requestId: RequestId; surface: SurfaceRef }
  | { type: "default-surface"; requestId: RequestId; surface: SurfaceRef }
  | { type: "tray-created"; requestId: RequestId; surfaceId: SurfaceId; trayId: TrayId }
  | { type: "ack"; requestId: RequestId }
  | { type: "event"; event: TrayEvent }
  | { type: "ext-event"; surfaceId: SurfaceId; trayId: TrayId; ext: string; data: unknown }
  | { type: "error"; requestId?: RequestId; code: string; message: string };

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

export const isServerFrame = (value: unknown): value is ServerFrame => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return (
        typeof value.protocolVersion === "number" &&
        typeof value.brokerVersion === "string" &&
        typeof value.leaseId === "string"
      );
    case "surface-created":
      return typeof value.requestId === "string" && isRecord(value.surface);
    case "default-surface":
      return typeof value.requestId === "string" && isRecord(value.surface);
    case "tray-created":
      return (
        typeof value.requestId === "string" &&
        typeof value.surfaceId === "string" &&
        typeof value.trayId === "string"
      );
    case "ack":
      return typeof value.requestId === "string";
    case "event":
      return isRecord(value.event);
    case "ext-event":
      return (
        typeof value.surfaceId === "string" &&
        typeof value.trayId === "string" &&
        typeof value.ext === "string"
      );
    case "error":
      return (
        (value.requestId === undefined || typeof value.requestId === "string") &&
        typeof value.code === "string" &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
};
