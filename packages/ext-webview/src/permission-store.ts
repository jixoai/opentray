import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const webviewBrowserPermissionFamilies = [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboardRead",
  "autoplay",
  "localFonts",
  "sensors",
  "midiSystemExclusive",
  "fileReadWrite",
  "multipleDownloads",
  "windowManagement",
] as const;

export type WebviewBrowserPermissionFamily =
  (typeof webviewBrowserPermissionFamilies)[number];

export type WebviewPermissionSource =
  | { type: "local" }
  | { type: "origin"; origin: `http://${string}` | `https://${string}` };

export type WebviewDurablePermissionDecision = "allow" | "deny";

export type WebviewPermissionPromptDecision =
  | WebviewDurablePermissionDecision
  | "allowOnce"
  | "prompt"
  | "unsupported";

export interface WebviewPermissionRecord {
  namespace: string;
  source: WebviewPermissionSource;
  family: WebviewBrowserPermissionFamily;
  decision: WebviewDurablePermissionDecision;
  createdAt: string;
  updatedAt: string;
  sourceAction: string;
}

export type WebviewPermissionSourceRule =
  | "'local'"
  | "'none'"
  | `http://${string}`
  | `https://${string}`;

export interface WebviewBrowserPermissionFamilyPolicy {
  sources?: WebviewPermissionSourceRule[];
  decision?: "allow" | "deny" | "prompt";
  prompt?: boolean;
}

export type WebviewBrowserPermissionPolicy = Partial<
  Record<WebviewBrowserPermissionFamily, WebviewBrowserPermissionFamilyPolicy>
>;

export interface WebviewPermissionManagerPolicy {
  defaultSrc?: WebviewPermissionSourceRule[];
  remoteOrigins?: (`http://${string}` | `https://${string}`)[];
}

export interface WebviewPermissionStore {
  readonly namespace: string;
  get(
    source: WebviewPermissionSource,
    family: WebviewBrowserPermissionFamily
  ): Promise<WebviewPermissionRecord | undefined>;
  set(
    input: Omit<WebviewPermissionRecord, "namespace" | "createdAt" | "updatedAt">
  ): Promise<WebviewPermissionRecord>;
  clear(
    source: WebviewPermissionSource,
    family: WebviewBrowserPermissionFamily
  ): Promise<boolean>;
  list(): Promise<WebviewPermissionRecord[]>;
}

export interface AppScopedWebviewPermissionStoreOptions {
  appId: string;
  namespace?: string;
  baseDir?: string;
  filePath?: string;
}

interface PermissionStoreFile {
  version: 1;
  namespace: string;
  records: WebviewPermissionRecord[];
}

export const createAppScopedWebviewPermissionStore = (
  options: AppScopedWebviewPermissionStoreOptions
): WebviewPermissionStore => {
  const namespace = options.namespace ?? options.appId;
  if (namespace.trim() === "") {
    throw new Error("permission store namespace must not be empty");
  }
  const filePath =
    options.filePath ??
    join(
      options.baseDir ?? join(homedir(), ".opentray", "permissions"),
      `${sanitizeNamespace(namespace)}.json`
    );

  const readStore = async (): Promise<PermissionStoreFile> => {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      return normalizeStoreFile(parsed, namespace);
    } catch (error) {
      if (isNodeFileNotFound(error)) {
        return { version: 1, namespace, records: [] };
      }
      throw error;
    }
  };

  const writeStore = async (store: PermissionStoreFile): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  };

  return {
    namespace,
    async get(source, family) {
      const store = await readStore();
      return store.records.find(
        (record) =>
          samePermissionSource(record.source, source) && record.family === family
      );
    },
    async set(input) {
      const store = await readStore();
      const now = new Date().toISOString();
      const existingIndex = store.records.findIndex(
        (record) =>
          samePermissionSource(record.source, input.source) &&
          record.family === input.family
      );
      const existing = store.records[existingIndex];
      const record: WebviewPermissionRecord = {
        ...input,
        namespace,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existingIndex === -1) {
        store.records.push(record);
      } else {
        store.records[existingIndex] = record;
      }
      await writeStore(store);
      return record;
    },
    async clear(source, family) {
      const store = await readStore();
      const records = store.records.filter(
        (record) =>
          !(
            samePermissionSource(record.source, source) &&
            record.family === family
          )
      );
      if (records.length === store.records.length) {
        return false;
      }
      await writeStore({ ...store, records });
      return true;
    },
    async list() {
      return (await readStore()).records;
    },
  };
};

const sanitizeNamespace = (namespace: string): string =>
  namespace.replace(/[^a-zA-Z0-9._-]+/g, "_");

const samePermissionSource = (
  left: WebviewPermissionSource,
  right: WebviewPermissionSource
): boolean => {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "local" || right.type === "local") {
    return true;
  }
  return left.origin === right.origin;
};

const normalizeStoreFile = (
  value: unknown,
  namespace: string
): PermissionStoreFile => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records)) {
    return { version: 1, namespace, records: [] };
  }
  return {
    version: 1,
    namespace,
    records: value.records.filter(isPermissionRecord),
  };
};

const isPermissionRecord = (value: unknown): value is WebviewPermissionRecord =>
  isRecord(value) &&
  typeof value.namespace === "string" &&
  isPermissionSource(value.source) &&
  webviewBrowserPermissionFamilies.includes(
    value.family as WebviewBrowserPermissionFamily
  ) &&
  (value.decision === "allow" || value.decision === "deny") &&
  typeof value.createdAt === "string" &&
  typeof value.updatedAt === "string" &&
  typeof value.sourceAction === "string";

const isPermissionSource = (value: unknown): value is WebviewPermissionSource =>
  isRecord(value) &&
  ((value.type === "local" && !("origin" in value)) ||
    (value.type === "origin" &&
      typeof value.origin === "string" &&
      (value.origin.startsWith("http://") ||
        value.origin.startsWith("https://"))));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeFileNotFound = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";
