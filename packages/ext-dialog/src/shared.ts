// Orthogonal intents (2026-09-17; add-ext-dialog batch C):
// 1. Keep every dialog option/DTO/error type plus option validation and wire
//    normalization as pure, transport-free data (design reference sections
//    1/2/7.5).
// 2. Freeze the typed dialog error code family and its structured details.
// 3. Never perform I/O here; the facade (index.ts) composes these pure pieces
//    with the tray extension transport.

import { join } from "node:path";

export type DialogPlatform = "darwin" | "win32" | "linux";

export type DialogNativePlatform = "darwin" | "win32";

export type DialogSeverity = "info" | "warning" | "error";

// ---------------------------------------------------------------------------
// Options (design reference section 1.1 common options, section 2 namespaces)
// ---------------------------------------------------------------------------

export interface MessageDialogResult {
  response: number;
  suppressed: boolean;
}

export interface FilePickFilter {
  name: string;
  /** Extension names without a leading dot, case-insensitive (e.g. "png", "tar.gz"). */
  extensions: readonly string[];
}

/** v1 is intentionally empty (design reference section 2.1): suppression is already common; sheet anchoring and accessory views are gated on future laws. The empty namespace stays expressible (`darwin: {}`). */
export interface DarwinMessageDialogNamespace {
  // Intentionally empty in v1.
}

export interface Win32MessageDialogExpander {
  expandedInformation: string;
  label?: string;
  expandedByDefault?: boolean;
}

export interface Win32MessageDialogNamespace {
  buttonStyle?: "standard" | "commandLink";
  /** Button-by-button hints aligned by index; only legal under `buttonStyle: "commandLink"`. */
  buttonHints?: readonly (string | undefined)[];
  footer?: string;
  expander?: Win32MessageDialogExpander;
  /** Frozen default `true` (P0-6): every closable dialog maps title-bar close to `cancelId`. */
  allowCancelOnClose?: boolean;
}

export interface MessageDialogOptions {
  message: string;
  detail?: string;
  /** Default `["OK"]`; responses return the pressed button's index. */
  buttons?: readonly string[];
  /** Default `0`: the button focused/activated by Enter. */
  defaultId?: number;
  /** ESC/title-bar dismissal resolves to this index; undefined maps dismissal to `0`. */
  cancelId?: number;
  severity?: DialogSeverity;
  suppressionLabel?: string;
  darwin?: DarwinMessageDialogNamespace;
  win32?: Win32MessageDialogNamespace;
}

/** Sugar options cannot override message/buttons/defaultId/cancelId (R2 P1-5 exact type freeze). */
export type MessageSugarOptions = Omit<
  MessageDialogOptions,
  "message" | "buttons" | "defaultId" | "cancelId"
>;

export interface DarwinFilePickNamespace {
  /** Default `false`: packages (.app and friends) selectable as files. */
  canSelectPackages?: boolean;
  /** Default `false`: packages browsable as directories. */
  treatsFilePackagesAsDirectories?: boolean;
  /** Default `true`: aliases resolve to their original target. */
  resolvesAliases?: boolean;
  /** Default `false`: files and directories selectable together (mixed results). */
  includeDirectories?: boolean;
  panelMessage?: string;
}

export interface Win32FilePickNamespace {
  /** Default `true`; `false` opts out of the shell recent-items list. */
  addToRecent?: boolean;
  okButtonLabel?: string;
}

export interface FilePickOptions {
  filters?: readonly FilePickFilter[];
  defaultPath?: string;
  title?: string;
  fileNameLabel?: string;
  showsHidden?: boolean;
  multiple?: boolean;
  darwin?: DarwinFilePickNamespace;
  win32?: Win32FilePickNamespace;
}

export interface Win32DirectoryPickNamespace {
  /** Default `true`; `false` opts out of the shell recent-items list. */
  addToRecent?: boolean;
}

export interface DirectoryPickOptions {
  defaultPath?: string;
  title?: string;
  showsHidden?: boolean;
  win32?: Win32DirectoryPickNamespace;
}

export interface DarwinSavePickNamespace {
  panelMessage?: string;
  /** Default `false`: allow keeping extensions outside the selected filter. */
  allowsOtherFileTypes?: boolean;
}

export interface Win32SavePickNamespace {
  /** Default `true`; `false` opts out of the shell recent-items list. */
  addToRecent?: boolean;
  /** Default `false`: block confirming with a mismatching extension. */
  strictFileTypes?: boolean;
  defaultExtension?: string;
  okButtonLabel?: string;
}

export interface SavePickOptions {
  filters?: readonly FilePickFilter[];
  defaultPath?: string;
  title?: string;
  fileNameLabel?: string;
  showsHidden?: boolean;
  defaultFilterIndex?: number;
  /** Default `true`; the win32 save panel is always able to create directories (documented degradation). */
  createDirectories?: boolean;
  darwin?: DarwinSavePickNamespace;
  win32?: Win32SavePickNamespace;
}

// ---------------------------------------------------------------------------
// Backend capabilities DTO (design reference section 7)
// ---------------------------------------------------------------------------

export interface DialogBackendCapabilities {
  platform: DialogNativePlatform;
  /** win32 comctl6 TaskDialog available; false means the MessageBox fallback. */
  taskDialog: boolean;
  /** Backing for the win32-only `buttonStyle: "commandLink"` switch. */
  commandLinks: boolean;
  /** Backing for the win32-only `expander` switch. */
  expander: boolean;
  /** Both platforms report suppression. */
  suppression: boolean;
  /** darwin package semantics (`canSelectPackages` / `treatsFilePackagesAsDirectories`). */
  packageSemantics: boolean;
  /** darwin mixed file+directory selection (`includeDirectories`). */
  mixedFileDirectorySelection: boolean;
  /** win32 `addToRecent` control. */
  addToRecentControl: boolean;
}

/** Wire event that answers the `getBackend` command on the immediate path. */
export interface DialogBackendEvent {
  type: "backend";
  backend: DialogBackendCapabilities;
}

/** Wire command surface of the dialog extension (camelCase `ext-command`
 * payloads). Command fields travel FLAT next to `type` — the exact shape the
 * native `DialogCommand` serde tag and the broker decode (issue #8: a nested
 * `{options: {...}}` wrapper never reached a decoder and every shipped
 * command rejected with 'unknown field `options`'). */
export type DialogCommand =
  | { type: "getBackend" }
  | ({ type: "messageDialog" } & MessageDialogWireOptions)
  | ({ type: "pickFile" } & FilePickOptions)
  | ({ type: "pickDirectory" } & DirectoryPickOptions)
  | ({ type: "pickSavePath" } & SavePickOptions);

/** Message options with the facade defaults applied (`buttons`/`defaultId` always present). */
export type MessageDialogWireOptions = Omit<
  MessageDialogOptions,
  "buttons" | "defaultId"
> & {
  buttons: readonly string[];
  defaultId: number;
};

// ---------------------------------------------------------------------------
// Typed error family (design reference section 7.5)
// ---------------------------------------------------------------------------

export const DIALOG_ERROR_CODES = {
  platformUnsupported: "dialog_platform_unsupported",
  platformNamespaceMismatch: "dialog_platform_namespace_mismatch",
  invalidOptions: "dialog_invalid_options",
  capabilityUnavailable: "dialog_capability_unavailable",
  sessionBusy: "dialog_session_busy",
  workerLimitReached: "dialog_worker_limit_reached",
  presentationFailed: "dialog_presentation_failed",
  dismissalUnavailable: "dialog_dismissal_unavailable",
  transportClosed: "dialog_transport_closed",
} as const;

export type DialogErrorCode = (typeof DIALOG_ERROR_CODES)[keyof typeof DIALOG_ERROR_CODES];

const DIALOG_ERROR_CODE_VALUES = new Set<string>(Object.values(DIALOG_ERROR_CODES));

export const isDialogErrorCode = (value: string): value is DialogErrorCode =>
  DIALOG_ERROR_CODE_VALUES.has(value);

/** Discriminated details payloads for facade-originated rejections (broker-originated details pass through unchanged). */
export type DialogErrorDetails =
  | { kind: "platform"; platform: string }
  | { kind: "namespace"; namespace: "darwin" | "win32"; platform: "darwin" | "win32" }
  | { kind: "options"; reason: string; field?: string }
  | { kind: "capability"; capability: DialogCapabilityFlag; platform: string }
  | { kind: "transport" };

export interface DialogErrorDescriptor {
  code: DialogErrorCode;
  message: string;
  details?: DialogErrorDetails;
}

/**
 * Typed rejection of the dialog facade: facade preflight failures, the
 * `dialog_transport_closed` mapping of the shared `extension_transport_closed`
 * core code, and normalized broker/native dialog rejections. Consumers match
 * on `code`; the human `message` is not a contract.
 */
export class DialogError extends Error {
  readonly code: DialogErrorCode;
  readonly details?: unknown;

  constructor(
    code: DialogErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DialogError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export const dialogErrorFromDescriptor = (
  descriptor: DialogErrorDescriptor,
  options: { cause?: unknown } = {}
): DialogError =>
  new DialogError(descriptor.code, descriptor.message, {
    ...(descriptor.details === undefined ? {} : { details: descriptor.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });

const invalidOptions = (reason: string, field?: string): DialogErrorDescriptor => ({
  code: DIALOG_ERROR_CODES.invalidOptions,
  message:
    field === undefined
      ? `invalid dialog options: ${reason}`
      : `invalid dialog options (${field}): ${reason}`,
  details: { kind: "options", reason, ...(field === undefined ? {} : { field }) },
});

const namespaceMismatch = (
  namespace: "darwin" | "win32",
  platform: DialogNativePlatform
): DialogErrorDescriptor => ({
  code: DIALOG_ERROR_CODES.platformNamespaceMismatch,
  message: `dialog options carry the ${namespace} namespace while running on ${platform}`,
  details: { kind: "namespace", namespace, platform },
});

export const platformUnsupported = (platform: string): DialogErrorDescriptor => ({
  code: DIALOG_ERROR_CODES.platformUnsupported,
  message: `native dialogs are unsupported on ${platform} (Linux has no native implementation; add-ext-dialog design reference section 0)`,
  details: { kind: "platform", platform },
});

// ---------------------------------------------------------------------------
// Runtime shape guards (wire results and DTO)
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const BACKEND_CAPABILITY_FLAGS = [
  "taskDialog",
  "commandLinks",
  "expander",
  "suppression",
  "packageSemantics",
  "mixedFileDirectorySelection",
  "addToRecentControl",
] as const;

export const isDialogBackendCapabilities = (
  value: unknown
): value is DialogBackendCapabilities => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.platform !== "darwin" && value.platform !== "win32") {
    return false;
  }
  for (const flag of BACKEND_CAPABILITY_FLAGS) {
    if (typeof value[flag] !== "boolean") {
      return false;
    }
  }
  return true;
};

export const isDialogBackendEvent = (value: unknown): value is DialogBackendEvent =>
  isRecord(value) && value.type === "backend" && "backend" in value;

export const isMessageDialogResult = (value: unknown): value is MessageDialogResult =>
  isRecord(value) &&
  typeof value.response === "number" &&
  Number.isInteger(value.response) &&
  typeof value.suppressed === "boolean";

export const isSinglePickResult = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length > 0);

export const isMultiplePickResult = (value: unknown): value is readonly string[] | null =>
  value === null ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0));

// ---------------------------------------------------------------------------
// Preflight validation (design reference sections 1.2 and 2; deterministic
// order: object shape -> unknown fields -> required message -> foreign
// namespace -> common field types -> buttons/indices -> current namespace
// contents). Everything here fails before any state change or transport use.
// ---------------------------------------------------------------------------

const MESSAGE_DIALOG_FIELDS = [
  "message",
  "detail",
  "buttons",
  "defaultId",
  "cancelId",
  "severity",
  "suppressionLabel",
  "darwin",
  "win32",
] as const;

const FILE_PICK_FIELDS = [
  "filters",
  "defaultPath",
  "title",
  "fileNameLabel",
  "showsHidden",
  "multiple",
  "darwin",
  "win32",
] as const;

const DIRECTORY_PICK_FIELDS = ["defaultPath", "title", "showsHidden", "win32"] as const;

const SAVE_PICK_FIELDS = [
  "filters",
  "defaultPath",
  "title",
  "fileNameLabel",
  "showsHidden",
  "defaultFilterIndex",
  "createDirectories",
  "darwin",
  "win32",
] as const;

const WIN32_MESSAGE_NAMESPACE_FIELDS = [
  "buttonStyle",
  "buttonHints",
  "footer",
  "expander",
  "allowCancelOnClose",
] as const;

const WIN32_MESSAGE_EXPANDER_FIELDS = [
  "expandedInformation",
  "label",
  "expandedByDefault",
] as const;

const DIALOG_SEVERITIES = ["info", "warning", "error"] as const;

export const DEFAULT_MESSAGE_DIALOG_BUTTONS: readonly string[] = ["OK"];

const firstUnknownField = (
  value: Record<string, unknown>,
  known: readonly string[]
): string | undefined => {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      return key;
    }
  }
  return undefined;
};

const checkOptionalString = (
  value: Record<string, unknown>,
  field: string
): DialogErrorDescriptor | null => {
  const entry = value[field];
  if (entry !== undefined && typeof entry !== "string") {
    return invalidOptions("must be a string when present", field);
  }
  return null;
};

const checkOptionalBoolean = (
  value: Record<string, unknown>,
  field: string
): DialogErrorDescriptor | null => {
  const entry = value[field];
  if (entry !== undefined && typeof entry !== "boolean") {
    return invalidOptions("must be a boolean when present", field);
  }
  return null;
};

interface NamespaceFieldSpec {
  booleans?: readonly string[];
  strings?: readonly string[];
}

const validateNamespaceFields = (
  namespace: string,
  value: Record<string, unknown>,
  spec: NamespaceFieldSpec
): DialogErrorDescriptor | null => {
  const booleans = spec.booleans ?? [];
  const strings = spec.strings ?? [];
  const known = [...booleans, ...strings];
  const unknown = firstUnknownField(value, known);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", `${namespace}.${unknown}`);
  }
  for (const field of booleans) {
    const entry = value[field];
    if (entry !== undefined && typeof entry !== "boolean") {
      return invalidOptions("must be a boolean when present", `${namespace}.${field}`);
    }
  }
  for (const field of strings) {
    const entry = value[field];
    if (entry !== undefined && typeof entry !== "string") {
      return invalidOptions("must be a string when present", `${namespace}.${field}`);
    }
  }
  return null;
};

const validateNamespacePresence = (
  options: Record<string, unknown>,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  const foreign: "win32" | "darwin" = platform === "darwin" ? "win32" : "darwin";
  if (options[foreign] !== undefined) {
    return namespaceMismatch(foreign, platform);
  }
  return null;
};

const validateNamespaceRecord = (
  options: Record<string, unknown>,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  const namespace = options[platform];
  if (namespace === undefined) {
    return null;
  }
  if (!isRecord(namespace)) {
    return invalidOptions("must be an object when present", platform);
  }
  return null;
};

const validateFileFilters = (value: unknown): DialogErrorDescriptor | null => {
  if (!Array.isArray(value)) {
    return invalidOptions("must be an array of filters when present", "filters");
  }
  // Design §1.2: 空/缺省 filters = 全部文件 — an explicitly empty array is
  // the caller's "all files" spelling and behaves like omitting the field.
  if (value.length === 0) {
    return null;
  }
  for (const [index, filter] of value.entries()) {
    if (!isRecord(filter)) {
      return invalidOptions(`entry ${index} must be an object`, `filters[${index}]`);
    }
    const unknown = firstUnknownField(filter, ["name", "extensions"]);
    if (unknown !== undefined) {
      return invalidOptions("unknown field", `filters[${index}].${unknown}`);
    }
    if (typeof filter.name !== "string") {
      return invalidOptions("must be a string", `filters[${index}].name`);
    }
    if (!Array.isArray(filter.extensions) || filter.extensions.length === 0) {
      return invalidOptions(
        "must be a non-empty array of extension names",
        `filters[${index}].extensions`
      );
    }
    for (const [extensionIndex, extension] of filter.extensions.entries()) {
      if (typeof extension !== "string" || extension.length === 0) {
        return invalidOptions(
          `entry ${extensionIndex} must be a non-empty extension name`,
          `filters[${index}].extensions`
        );
      }
      if (
        extension.startsWith(".") ||
        extension.includes("/") ||
        extension.includes("\\")
      ) {
        return invalidOptions(
          `entry ${extensionIndex} must be an extension name without a leading dot or path separators`,
          `filters[${index}].extensions`
        );
      }
    }
  }
  return null;
};

const validateButtonsAndIndices = (
  options: Record<string, unknown>
): DialogErrorDescriptor | null => {
  if (options.buttons !== undefined) {
    if (!Array.isArray(options.buttons) || options.buttons.length === 0) {
      return invalidOptions("must be a non-empty array of button labels", "buttons");
    }
    for (const [index, label] of options.buttons.entries()) {
      if (typeof label !== "string") {
        return invalidOptions(`entry ${index} must be a string`, "buttons");
      }
    }
  }
  const count = (
    options.buttons === undefined ? DEFAULT_MESSAGE_DIALOG_BUTTONS : options.buttons
  ).length;
  for (const field of ["defaultId", "cancelId"] as const) {
    const entry = options[field];
    if (entry === undefined) {
      continue;
    }
    if (typeof entry !== "number" || !Number.isInteger(entry)) {
      return invalidOptions("must be an integer button index", field);
    }
    if (entry < 0 || entry >= count) {
      return invalidOptions(
        `must index into buttons (0..${count - 1}); empty or out-of-range indices are rejected before any state change`,
        field
      );
    }
  }
  return null;
};

const validateWin32MessageNamespace = (
  namespace: Record<string, unknown>,
  options: Record<string, unknown>
): DialogErrorDescriptor | null => {
  const unknown = firstUnknownField(namespace, WIN32_MESSAGE_NAMESPACE_FIELDS);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", `win32.${unknown}`);
  }
  if (
    namespace.buttonStyle !== undefined &&
    namespace.buttonStyle !== "standard" &&
    namespace.buttonStyle !== "commandLink"
  ) {
    return invalidOptions('must be "standard" or "commandLink"', "win32.buttonStyle");
  }
  if (namespace.buttonHints !== undefined) {
    if (namespace.buttonStyle !== "commandLink") {
      return invalidOptions(
        'buttonHints are only legal under win32.buttonStyle "commandLink"',
        "win32.buttonHints"
      );
    }
    if (!Array.isArray(namespace.buttonHints)) {
      return invalidOptions("must be an array aligned with buttons by index", "win32.buttonHints");
    }
    const rawButtons = options.buttons;
    const buttonCount = Array.isArray(rawButtons)
      ? rawButtons.length
      : DEFAULT_MESSAGE_DIALOG_BUTTONS.length;
    if (namespace.buttonHints.length !== buttonCount) {
      return invalidOptions(
        `must align with buttons by index (${buttonCount} entries expected)`,
        "win32.buttonHints"
      );
    }
    for (const [index, hint] of namespace.buttonHints.entries()) {
      if (hint !== undefined && typeof hint !== "string") {
        return invalidOptions(`entry ${index} must be a string or undefined`, "win32.buttonHints");
      }
    }
  }
  if (namespace.footer !== undefined && typeof namespace.footer !== "string") {
    return invalidOptions("must be a string when present", "win32.footer");
  }
  if (
    namespace.allowCancelOnClose !== undefined &&
    typeof namespace.allowCancelOnClose !== "boolean"
  ) {
    return invalidOptions("must be a boolean when present", "win32.allowCancelOnClose");
  }
  if (namespace.expander !== undefined) {
    if (!isRecord(namespace.expander)) {
      return invalidOptions("must be an object when present", "win32.expander");
    }
    const expanderUnknown = firstUnknownField(namespace.expander, WIN32_MESSAGE_EXPANDER_FIELDS);
    if (expanderUnknown !== undefined) {
      return invalidOptions("unknown field", `win32.expander.${expanderUnknown}`);
    }
    if (typeof namespace.expander.expandedInformation !== "string") {
      return invalidOptions(
        "must be a string", "win32.expander.expandedInformation");
    }
    if (
      namespace.expander.label !== undefined &&
      typeof namespace.expander.label !== "string"
    ) {
      return invalidOptions("must be a string when present", "win32.expander.label");
    }
    if (
      namespace.expander.expandedByDefault !== undefined &&
      typeof namespace.expander.expandedByDefault !== "boolean"
    ) {
      return invalidOptions(
        "must be a boolean when present",
        "win32.expander.expandedByDefault"
      );
    }
  }
  return null;
};

export const validateMessageDialogOptions = (
  options: unknown,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  if (!isRecord(options)) {
    return invalidOptions("options must be an object");
  }
  const unknown = firstUnknownField(options, MESSAGE_DIALOG_FIELDS);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", unknown);
  }
  if (typeof options.message !== "string") {
    return invalidOptions("must be a string", "message");
  }
  const mismatch = validateNamespacePresence(options, platform);
  if (mismatch !== null) {
    return mismatch;
  }
  const namespaceShape = validateNamespaceRecord(options, platform);
  if (namespaceShape !== null) {
    return namespaceShape;
  }
  for (const field of ["detail", "suppressionLabel"] as const) {
    const issue = checkOptionalString(options, field);
    if (issue !== null) {
      return issue;
    }
  }
  if (options.severity !== undefined) {
    if (typeof options.severity !== "string") {
      return invalidOptions("must be a string when present", "severity");
    }
    if (!(DIALOG_SEVERITIES as readonly string[]).includes(options.severity)) {
      return invalidOptions('must be "info", "warning", or "error"', "severity");
    }
  }
  const buttonsIssue = validateButtonsAndIndices(options);
  if (buttonsIssue !== null) {
    return buttonsIssue;
  }
  const namespace = options[platform];
  if (namespace !== undefined) {
    if (platform === "darwin") {
      const darwinUnknown = firstUnknownField(
        namespace as Record<string, unknown>,
        []
      );
      if (darwinUnknown !== undefined) {
        return invalidOptions("unknown field (the v1 darwin message namespace is empty)", `darwin.${darwinUnknown}`);
      }
    } else {
      const win32Issue = validateWin32MessageNamespace(
        namespace as Record<string, unknown>,
        options
      );
      if (win32Issue !== null) {
        return win32Issue;
      }
    }
  }
  return null;
};

export const validateFilePickOptions = (
  options: unknown,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  if (options === undefined) {
    return null;
  }
  if (!isRecord(options)) {
    return invalidOptions("options must be an object");
  }
  const unknown = firstUnknownField(options, FILE_PICK_FIELDS);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", unknown);
  }
  const mismatch = validateNamespacePresence(options, platform);
  if (mismatch !== null) {
    return mismatch;
  }
  const namespaceShape = validateNamespaceRecord(options, platform);
  if (namespaceShape !== null) {
    return namespaceShape;
  }
  if (options.filters !== undefined) {
    const filtersIssue = validateFileFilters(options.filters);
    if (filtersIssue !== null) {
      return filtersIssue;
    }
  }
  for (const field of ["defaultPath", "title", "fileNameLabel"] as const) {
    const issue = checkOptionalString(options, field);
    if (issue !== null) {
      return issue;
    }
  }
  const showsHiddenIssue = checkOptionalBoolean(options, "showsHidden");
  if (showsHiddenIssue !== null) {
    return showsHiddenIssue;
  }
  const multipleIssue = checkOptionalBoolean(options, "multiple");
  if (multipleIssue !== null) {
    return multipleIssue;
  }
  const namespace = options[platform];
  if (namespace !== undefined) {
    const spec: NamespaceFieldSpec =
      platform === "darwin"
        ? {
            booleans: [
              "canSelectPackages",
              "treatsFilePackagesAsDirectories",
              "resolvesAliases",
              "includeDirectories",
            ],
            strings: ["panelMessage"],
          }
        : { booleans: ["addToRecent"], strings: ["okButtonLabel"] };
    const issue = validateNamespaceFields(platform, namespace as Record<string, unknown>, spec);
    if (issue !== null) {
      return issue;
    }
  }
  return null;
};

export const validateDirectoryPickOptions = (
  options: unknown,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  if (options === undefined) {
    return null;
  }
  if (!isRecord(options)) {
    return invalidOptions("options must be an object");
  }
  const unknown = firstUnknownField(options, DIRECTORY_PICK_FIELDS);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", unknown);
  }
  const mismatch = validateNamespacePresence(options, platform);
  if (mismatch !== null) {
    return mismatch;
  }
  const namespaceShape = validateNamespaceRecord(options, platform);
  if (namespaceShape !== null) {
    return namespaceShape;
  }
  for (const field of ["defaultPath", "title"] as const) {
    const issue = checkOptionalString(options, field);
    if (issue !== null) {
      return issue;
    }
  }
  const showsHiddenIssue = checkOptionalBoolean(options, "showsHidden");
  if (showsHiddenIssue !== null) {
    return showsHiddenIssue;
  }
  const namespace = options[platform];
  if (namespace !== undefined) {
    const issue = validateNamespaceFields(
      platform,
      namespace as Record<string, unknown>,
      platform === "darwin"
        ? { booleans: [], strings: [] }
        : { booleans: ["addToRecent"], strings: [] }
    );
    if (issue !== null) {
      return issue;
    }
  }
  return null;
};

export const validateSavePickOptions = (
  options: unknown,
  platform: DialogNativePlatform
): DialogErrorDescriptor | null => {
  if (options === undefined) {
    return null;
  }
  if (!isRecord(options)) {
    return invalidOptions("options must be an object");
  }
  const unknown = firstUnknownField(options, SAVE_PICK_FIELDS);
  if (unknown !== undefined) {
    return invalidOptions("unknown field", unknown);
  }
  const mismatch = validateNamespacePresence(options, platform);
  if (mismatch !== null) {
    return mismatch;
  }
  const namespaceShape = validateNamespaceRecord(options, platform);
  if (namespaceShape !== null) {
    return namespaceShape;
  }
  if (options.filters !== undefined) {
    const filtersIssue = validateFileFilters(options.filters);
    if (filtersIssue !== null) {
      return filtersIssue;
    }
  }
  if (options.defaultFilterIndex !== undefined) {
    if (!Array.isArray(options.filters)) {
      return invalidOptions("requires filters to be present", "defaultFilterIndex");
    }
    const index = options.defaultFilterIndex;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= options.filters.length) {
      return invalidOptions("must be an integer index into filters", "defaultFilterIndex");
    }
  }
  for (const field of ["defaultPath", "title", "fileNameLabel"] as const) {
    const issue = checkOptionalString(options, field);
    if (issue !== null) {
      return issue;
    }
  }
  for (const field of ["showsHidden", "createDirectories"] as const) {
    const issue = checkOptionalBoolean(options, field);
    if (issue !== null) {
      return issue;
    }
  }
  const namespace = options[platform];
  if (namespace !== undefined) {
    const spec: NamespaceFieldSpec =
      platform === "darwin"
        ? { booleans: ["allowsOtherFileTypes"], strings: ["panelMessage"] }
        : {
            booleans: ["addToRecent", "strictFileTypes"],
            strings: ["defaultExtension", "okButtonLabel"],
          };
    const issue = validateNamespaceFields(platform, namespace as Record<string, unknown>, spec);
    if (issue !== null) {
      return issue;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Capability preflight (design reference section 7: the DTO is the runtime
// fact source for namespace-switch availability; comctl6-gated family only,
// per section 5.3's frozen commandLink/expander rejection list)
// ---------------------------------------------------------------------------

export type DialogCapabilityFlag = "taskDialog" | "commandLinks" | "expander";

export const messageDialogCapabilityRequirements = (
  options: Pick<MessageDialogOptions, "win32">,
  platform: DialogPlatform
): readonly DialogCapabilityFlag[] => {
  if (platform !== "win32") {
    return [];
  }
  const flags: DialogCapabilityFlag[] = [];
  if (options.win32?.buttonStyle === "commandLink") {
    flags.push("taskDialog", "commandLinks");
  }
  if (options.win32?.expander !== undefined) {
    flags.push("taskDialog", "expander");
  }
  return flags;
};

// ---------------------------------------------------------------------------
// Wire normalization (pure): apply defaults, strip undefined values, and keep
// only explicitly-present namespace fields; `darwin: {}` stays expressible.
// ---------------------------------------------------------------------------

const omitUndefinedFields = <T extends object>(value: T): T => {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      out[key] = entry;
    }
  }
  return out as T;
};

export const messageDialogCommandOptions = (
  options: MessageDialogOptions
): MessageDialogWireOptions => ({
  message: options.message,
  buttons: options.buttons ?? DEFAULT_MESSAGE_DIALOG_BUTTONS,
  defaultId: options.defaultId ?? 0,
  ...(options.cancelId !== undefined ? { cancelId: options.cancelId } : {}),
  ...(options.detail !== undefined ? { detail: options.detail } : {}),
  ...(options.severity !== undefined ? { severity: options.severity } : {}),
  ...(options.suppressionLabel !== undefined
    ? { suppressionLabel: options.suppressionLabel }
    : {}),
  ...(options.darwin !== undefined ? { darwin: omitUndefinedFields(options.darwin) } : {}),
  ...(options.win32 !== undefined ? { win32: omitUndefinedFields(options.win32) } : {}),
});

export const filePickCommandOptions = (
  options: FilePickOptions | undefined
): FilePickOptions => {
  const source = options ?? {};
  return {
    // Design §1.2: 空/缺省 filters = 全部文件 — an explicitly empty array
    // normalizes to wire omission (darwin setAllowedContentTypes([]) would
    // mean "nothing selectable"; omission leaves the panel unrestricted).
    ...(source.filters !== undefined && source.filters.length > 0
      ? { filters: source.filters }
      : {}),
    ...(source.defaultPath !== undefined ? { defaultPath: source.defaultPath } : {}),
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.fileNameLabel !== undefined
      ? { fileNameLabel: source.fileNameLabel }
      : {}),
    ...(source.showsHidden !== undefined ? { showsHidden: source.showsHidden } : {}),
    ...(source.multiple === true ? { multiple: true } : {}),
    ...(source.darwin !== undefined
      ? { darwin: omitUndefinedFields(source.darwin) }
      : {}),
    ...(source.win32 !== undefined ? { win32: omitUndefinedFields(source.win32) } : {}),
  };
};

export const directoryPickCommandOptions = (
  options: DirectoryPickOptions | undefined
): DirectoryPickOptions => {
  const source = options ?? {};
  return {
    ...(source.defaultPath !== undefined ? { defaultPath: source.defaultPath } : {}),
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.showsHidden !== undefined ? { showsHidden: source.showsHidden } : {}),
    ...(source.win32 !== undefined ? { win32: omitUndefinedFields(source.win32) } : {}),
  };
};

export const savePickCommandOptions = (
  options: SavePickOptions | undefined
): SavePickOptions => {
  const source = options ?? {};
  return {
    // Same all-files normalization as filePickCommandOptions.
    ...(source.filters !== undefined && source.filters.length > 0
      ? { filters: source.filters }
      : {}),
    ...(source.defaultPath !== undefined ? { defaultPath: source.defaultPath } : {}),
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.fileNameLabel !== undefined
      ? { fileNameLabel: source.fileNameLabel }
      : {}),
    ...(source.showsHidden !== undefined ? { showsHidden: source.showsHidden } : {}),
    ...(source.defaultFilterIndex !== undefined
      ? { defaultFilterIndex: source.defaultFilterIndex }
      : {}),
    ...(source.createDirectories !== undefined
      ? { createDirectories: source.createDirectories }
      : {}),
    ...(source.darwin !== undefined
      ? { darwin: omitUndefinedFields(source.darwin) }
      : {}),
    ...(source.win32 !== undefined ? { win32: omitUndefinedFields(source.win32) } : {}),
  };
};

/** Sugar options cannot override the frozen fields; the facade applies the fixed button sets (design reference section 1.2). Fixed fields always win over any runtime-provided values. */
export const sugarMessageOptions = (
  message: string,
  options: MessageSugarOptions | undefined,
  buttons: readonly string[],
  defaultId: number,
  cancelId?: number
): MessageDialogOptions => ({
  ...(options === undefined ? {} : omitUndefinedFields(options)),
  message,
  buttons,
  defaultId,
  ...(cancelId === undefined ? {} : { cancelId }),
});

/** Expand a leading `~` against the supplied home directory (picker-result canonicalization input). */
export const expandHomeDirectory = (value: string, home: string): string => {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return join(home, value.slice(2));
  }
  return value;
};
