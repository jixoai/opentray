export type SessionId = string;
export type RequestId = string;
export type AppId = string;
export type TrayId = string;
export type MenuItemId = number;

export const PROTOCOL_VERSION = 1;
export const OPENTRAY_PROTOCOL_FAMILY = "opentray-protocol";
export const OPENTRAY_PROTOCOL_LINE_MAJOR = 1;
export const OPENTRAY_PROTOCOL_LINE_MINOR = 1;

export const protocolLineReleaseChannels = ["stable", "alpha"] as const;
export type ProtocolLineReleaseChannel =
  (typeof protocolLineReleaseChannels)[number];

export interface OpenTrayProtocolLine {
  family: typeof OPENTRAY_PROTOCOL_FAMILY;
  major: number;
  minor: number;
}

export interface ProtocolDistTagOptions {
  channel: ProtocolLineReleaseChannel;
  major?: number;
  minor?: number;
}

export interface ProtocolDistTag {
  channel: ProtocolLineReleaseChannel;
  major: number;
  minor: number;
}

export const OPENTRAY_PROTOCOL_LINE: OpenTrayProtocolLine = {
  family: OPENTRAY_PROTOCOL_FAMILY,
  major: OPENTRAY_PROTOCOL_LINE_MAJOR,
  minor: OPENTRAY_PROTOCOL_LINE_MINOR,
};

// Install-time protocol lines can advance by minor version while runtime authority stays numeric.
export const compareOpenTrayProtocolLine = (
  left: OpenTrayProtocolLine,
  right: OpenTrayProtocolLine
): number => {
  assertOpenTrayProtocolLine(left, "left");
  assertOpenTrayProtocolLine(right, "right");
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  return left.minor - right.minor;
};

export const isOpenTrayProtocolLineCompatible = (
  supported: OpenTrayProtocolLine,
  required: OpenTrayProtocolLine
): boolean => {
  assertOpenTrayProtocolLine(supported, "supported");
  assertOpenTrayProtocolLine(required, "required");
  return (
    supported.major === required.major && supported.minor >= required.minor
  );
};

export const formatOpenTrayProtocolLine = ({
  family,
  major,
  minor,
}: OpenTrayProtocolLine = OPENTRAY_PROTOCOL_LINE): string => {
  assertProtocolLineVersion(major, "major");
  assertProtocolLineVersion(minor, "minor");
  return `${family}/${major}.${minor}`;
};

export const isProtocolLineReleaseChannel = (
  value: string
): value is ProtocolLineReleaseChannel =>
  protocolLineReleaseChannels.includes(value as ProtocolLineReleaseChannel);

export const formatProtocolDistTag = ({
  channel,
  major = OPENTRAY_PROTOCOL_LINE_MAJOR,
  minor = OPENTRAY_PROTOCOL_LINE_MINOR,
}: ProtocolDistTagOptions): string => {
  assertProtocolLineReleaseChannel(channel);
  assertProtocolLineVersion(major, "major");
  assertProtocolLineVersion(minor, "minor");
  return `${channel}-${major}-${minor}`;
};

export const parseProtocolDistTag = (tag: string): ProtocolDistTag => {
  const match = /^(?<channel>[a-z]+)-(?<major>\d+)-(?<minor>\d+)$/u.exec(tag);
  const groups = match?.groups;
  if (groups === undefined) {
    throw new Error(`invalid OpenTray protocol dist-tag: ${tag}`);
  }
  const channel = groups.channel;
  if (channel === undefined || !isProtocolLineReleaseChannel(channel)) {
    throw new Error(
      `unsupported OpenTray protocol dist-tag channel: ${channel ?? ""}`
    );
  }
  const major = Number(groups.major);
  const minor = Number(groups.minor);
  assertProtocolLineVersion(major, "major");
  assertProtocolLineVersion(minor, "minor");
  return { channel, major, minor };
};

/**
 * Neutral caller label used when no usable caller identity can be derived.
 * Keeps the broker honest instead of impersonating an unrelated application.
 */
export const DEFAULT_CALLER_LABEL = "opentray";

/**
 * Maximum length of a sanitized caller label. Keeps socket paths, runtime
 * directory names, and process titles within platform limits.
 */
export const CALLER_LABEL_MAX_LENGTH = 48;

const callerLabelAllowedPattern = /[a-z0-9-]+/g;

export interface BrokerEndpointIdentity {
  packageVersion: string;
  protocolVersion: number;
  callerLabel: string;
}

export interface BrokerEndpointIdentityOptions {
  packageVersion: string;
  protocolVersion?: number;
  callerLabel?: string;
}

export const sanitizeCallerLabel = (value: string | undefined): string => {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`callerLabel must be a string: ${String(value)}`);
  }
  const raw = value ?? "";
  const lowered = raw.toLowerCase();
  const segments = lowered.match(callerLabelAllowedPattern);
  if (segments === null || segments.length === 0) {
    return DEFAULT_CALLER_LABEL;
  }
  const joined = segments.join("-");
  const trimmed = joined.replace(/^-+|-+$/gu, "");
  if (trimmed.length === 0) {
    return DEFAULT_CALLER_LABEL;
  }
  return trimmed.slice(0, CALLER_LABEL_MAX_LENGTH);
};

export const createBrokerEndpointIdentity = ({
  packageVersion,
  protocolVersion = PROTOCOL_VERSION,
  callerLabel,
}: BrokerEndpointIdentityOptions): BrokerEndpointIdentity => {
  assertEndpointComponent(packageVersion, "packageVersion");
  if (!Number.isInteger(protocolVersion) || protocolVersion <= 0) {
    throw new Error(
      `protocolVersion must be a positive integer: ${protocolVersion}`
    );
  }

  return {
    packageVersion,
    protocolVersion,
    callerLabel: sanitizeCallerLabel(callerLabel),
  };
};

export const isSupportedProtocolVersion = (protocolVersion: number): boolean =>
  protocolVersion === PROTOCOL_VERSION;

export const formatBrokerEndpointName = (
  identity: BrokerEndpointIdentity
): string => {
  assertEndpointIdentity(identity);
  return `opentray-${identity.packageVersion}-p${identity.protocolVersion}-${identity.callerLabel}`;
};

export const formatBrokerStateRoot = (
  homeDir: string,
  identity: BrokerEndpointIdentity
): string => {
  assertEndpointIdentity(identity);
  if (homeDir.length === 0) {
    throw new Error("homeDir must not be empty");
  }

  const normalizedHome = homeDir.replace(/[\\/]+$/u, "");
  return `${normalizedHome}/.opentray/${identity.packageVersion}/${identity.callerLabel}`;
};

export const formatUnixSocketPath = (
  homeDir: string,
  identity: BrokerEndpointIdentity
): string =>
  `${formatBrokerStateRoot(homeDir, identity)}/opentray-p${
    identity.protocolVersion
  }.sock`;

export const formatWindowsPipeName = (
  identity: BrokerEndpointIdentity
): string => `\\\\.\\pipe\\${formatBrokerEndpointName(identity)}`;

/**
 * Human-readable process title for a broker pinned to a caller. Used by the SDK
 * spawn path so task managers show the owning application, not a generic name.
 */
export const formatBrokerProcessTitle = (
  identity: BrokerEndpointIdentity
): string => {
  assertEndpointIdentity(identity);
  return `opentray · ${identity.callerLabel}`;
};

const endpointComponentPattern = /^[0-9A-Za-z._+-]+$/u;

const assertOpenTrayProtocolLine = (
  line: OpenTrayProtocolLine,
  name: string
): void => {
  assertProtocolLineVersion(line.major, `${name}.major`);
  assertProtocolLineVersion(line.minor, `${name}.minor`);
};

const assertProtocolLineReleaseChannel = (channel: string): void => {
  if (!isProtocolLineReleaseChannel(channel)) {
    throw new Error(
      `unsupported OpenTray protocol release channel: ${channel}`
    );
  }
};

const assertProtocolLineVersion = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `protocol line ${name} must be a non-negative integer: ${value}`
    );
  }
};

const assertEndpointIdentity = (identity: BrokerEndpointIdentity): void => {
  assertEndpointComponent(identity.packageVersion, "packageVersion");
  if (
    !Number.isInteger(identity.protocolVersion) ||
    identity.protocolVersion <= 0
  ) {
    throw new Error(
      `protocolVersion must be a positive integer: ${identity.protocolVersion}`
    );
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

export interface AppOptions {
  id?: AppId;
  name?: string;
  icon?: Icon;
  default?: boolean;
}

export interface AppRef {
  appId: AppId;
}

export interface AppIdentity {
  appId: AppId;
  appName: string;
}

export interface TrayOptions {
  id: string;
  tooltip?: Tooltip;
  icon?: Icon;
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
      primaryEvent?: boolean;
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

export type IconImage =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

export type SimpleIcon = IconImage & { text?: string };

export type IconText = IconImage & { text: string };

export interface IconCandidates {
  "icon-only"?: IconImage;
  "text-only"?: string;
  "icon-text"?: IconText;
}

export type Icon = IconCandidates & Partial<SimpleIcon>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TrayBoundsKind = "native" | "inferred" | "unavailable";

export interface TrayBoundsResult {
  kind: TrayBoundsKind;
  source: string;
  rect: Rect | null;
}

export type MouseButton = "left" | "right" | "middle";

export type TrayEvent =
  | { type: "ready"; appId: AppId }
  | { type: "menuClick"; appId: AppId; trayId: TrayId; itemId: MenuItemId }
  | {
      type: "trayClick";
      appId: AppId;
      trayId: TrayId;
      button: MouseButton;
      x: number;
      y: number;
    }
  | {
      type: "trayDoubleClick";
      appId: AppId;
      trayId: TrayId;
      button: MouseButton;
      x: number;
      y: number;
    };

export interface ExtensionScope {
  appId: AppId;
  trayId?: TrayId;
  ext: string;
}

export interface ExtensionEnvelope<TData = unknown> {
  scope: ExtensionScope;
  data: TData;
}

export interface RuntimeHostSessionHealth {
  sessionId: number;
  internalSessionId?: SessionId;
  initialized: boolean;
}

export interface RuntimeHostHealth {
  pid: number;
  packageVersion: string;
  protocolVersion: number;
  endpoint: string;
  appId: AppId;
  appName: string;
  callerLabel: string;
  sessionCount: number;
  sessions: RuntimeHostSessionHealth[];
}

export type ClientFrame =
  | { type: "init"; protocolVersion: number; clientVersion: string }
  | ClientRequestFrame
  | { type: "exit" };

export type ClientRequestFrame =
  | ({ type: "create-app"; requestId: RequestId } & AppOptions)
  | { type: "resolve-default-app"; requestId: RequestId }
  | {
      type: "create-tray";
      requestId: RequestId;
      app: AppRef;
      tray: TrayOptions;
    }
  | { type: "destroy-tray"; requestId: RequestId; appId: AppId; trayId: TrayId }
  | {
      type: "get-tray-bounds";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
    }
  | {
      type: "set-tray-menu";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
      menu: Menu;
    }
  | {
      type: "set-tray-icon";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
      icon: Icon;
    }
  | {
      type: "set-tray-tooltip";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
      tooltip: Tooltip;
    }
  | {
      type: "load-ext";
      requestId: RequestId;
      appId: AppId;
      name: string;
      path: string;
      mountId?: string;
    }
  | {
      type: "ext-command";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
      ext: string;
      data: unknown;
    }
  | { type: "unload-ext"; requestId: RequestId; appId: AppId; name: string }
  | { type: "health"; requestId: RequestId };

export type ServerFrame =
  | {
      type: "ready";
      protocolVersion: number;
      brokerVersion: string;
      sessionId: SessionId;
    }
  | { type: "app-created"; requestId: RequestId; app: AppRef }
  | { type: "default-app"; requestId: RequestId; app: AppRef }
  | { type: "tray-created"; requestId: RequestId; appId: AppId; trayId: TrayId }
  | {
      type: "tray-bounds";
      requestId: RequestId;
      appId: AppId;
      trayId: TrayId;
      bounds: TrayBoundsResult;
    }
  | { type: "ack"; requestId: RequestId }
  | {
      type: "ext-command-result";
      requestId: RequestId;
      events: ExtensionEnvelope[];
    }
  | {
      type: "runtime-host-health";
      requestId: RequestId;
      health: RuntimeHostHealth;
    }
  | { type: "event"; event: TrayEvent }
  | {
      type: "ext-event";
      appId: AppId;
      trayId: TrayId;
      ext: string;
      data: unknown;
    }
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
        typeof value.sessionId === "string"
      );
    case "app-created":
      return typeof value.requestId === "string" && isRecord(value.app);
    case "default-app":
      return typeof value.requestId === "string" && isRecord(value.app);
    case "tray-created":
      return (
        typeof value.requestId === "string" &&
        typeof value.appId === "string" &&
        typeof value.trayId === "string"
      );
    case "tray-bounds":
      return (
        typeof value.requestId === "string" &&
        typeof value.appId === "string" &&
        typeof value.trayId === "string" &&
        isTrayBoundsResult(value.bounds)
      );
    case "ack":
      return typeof value.requestId === "string";
    case "ext-command-result":
      return (
        typeof value.requestId === "string" &&
        Array.isArray(value.events) &&
        value.events.every(isExtensionEnvelope)
      );
    case "runtime-host-health":
      return (
        typeof value.requestId === "string" && isRuntimeHostHealth(value.health)
      );
    case "event":
      return isTrayEvent(value.event);
    case "ext-event":
      return (
        typeof value.appId === "string" &&
        typeof value.trayId === "string" &&
        typeof value.ext === "string"
      );
    case "error":
      return (
        (value.requestId === undefined ||
          typeof value.requestId === "string") &&
        typeof value.code === "string" &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
};

const isExtensionEnvelope = (value: unknown): value is ExtensionEnvelope => {
  if (!isRecord(value) || !isRecord(value.scope)) {
    return false;
  }
  const scope = value.scope as Record<string, unknown>;
  return (
    typeof scope.appId === "string" &&
    (scope.trayId === undefined || typeof scope.trayId === "string") &&
    typeof scope.ext === "string" &&
    "data" in value
  );
};

const isRuntimeHostHealth = (value: unknown): value is RuntimeHostHealth => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.pid === "number" &&
    typeof value.packageVersion === "string" &&
    typeof value.protocolVersion === "number" &&
    typeof value.endpoint === "string" &&
    typeof value.appId === "string" &&
    typeof value.appName === "string" &&
    typeof value.callerLabel === "string" &&
    typeof value.sessionCount === "number" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isRuntimeHostSessionHealth)
  );
};

const isRuntimeHostSessionHealth = (
  value: unknown
): value is RuntimeHostSessionHealth =>
  isRecord(value) &&
  typeof value.sessionId === "number" &&
  (value.internalSessionId === undefined ||
    typeof value.internalSessionId === "string") &&
  typeof value.initialized === "boolean";

const isRect = (value: unknown): value is Rect =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number";

const isTrayBoundsResult = (value: unknown): value is TrayBoundsResult =>
  isRecord(value) &&
  (value.kind === "native" ||
    value.kind === "inferred" ||
    value.kind === "unavailable") &&
  typeof value.source === "string" &&
  (value.rect === null || isRect(value.rect));

const isTrayEvent = (value: unknown): value is TrayEvent => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return typeof value.appId === "string";
    case "menuClick":
      return (
        typeof value.appId === "string" &&
        typeof value.trayId === "string" &&
        typeof value.itemId === "number"
      );
    case "trayClick":
    case "trayDoubleClick":
      return (
        typeof value.appId === "string" &&
        typeof value.trayId === "string" &&
        isMouseButton(value.button) &&
        typeof value.x === "number" &&
        typeof value.y === "number"
      );
    default:
      return false;
  }
};

const isMouseButton = (value: unknown): value is MouseButton =>
  value === "left" || value === "right" || value === "middle";
