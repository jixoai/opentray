import type {
  DownloadCompletedPayload,
  DownloadEventName,
  DownloadProgressPayload,
  DownloadStartedPayload,
  WebviewBridge,
} from "$lib/types";
import { DOWNLOAD_EVENT_NAMES, listenDownload } from "$lib/bridge";

const EVENT_LOG_CAP = 60;

export type EventLogLevel = "info" | "success" | "warn" | "error";

export interface EventLogEntry {
  id: number;
  ts: number;
  event: string;
  level: EventLogLevel;
  payload: unknown;
}

export interface ActiveDownload {
  // Correlation key derived from the start payload. The native runtime captures
  // the download metadata once (url + filename + suggestedFilename) and clones
  // it into every later event, so `url` is stable across the lifecycle of one
  // download on both macOS and Windows.
  key: string;
  url: string;
  filename: string;
  suggestedFilename: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  status: "started" | "progress" | "completed" | "failed" | "canceled";
  success?: boolean;
  startedAt: number;
  finishedAt?: number;
}

let entryIdCounter = 0;

const levelFor = (event: DownloadEventName): EventLogLevel => {
  switch (event) {
    case "downloadcompleted":
      return "success";
    case "downloadfailed":
      return "error";
    case "downloadcanceled":
      return "warn";
    default:
      return "info";
  }
};

const keyFor = (payload: DownloadStartedPayload): string =>
  // Prefer blob/origin url (most stable per-trigger); fall back to filename.
  payload.url || payload.filename || "unknown";

class DownloadEventStore {
  // Flat $state arrays. We replace these with new arrays on every change so
  // Svelte 5 runes reliably propagate updates to every consumer, including
  // row-internal field mutations (status, receivedBytes, etc.).
  entries = $state<EventLogEntry[]>([]);
  active = $state<ActiveDownload[]>([]);
  counts = $state<Record<DownloadEventName, number>>({
    downloadstarted: 0,
    downloadprogress: 0,
    downloadcompleted: 0,
    downloadfailed: 0,
    downloadcanceled: 0,
  });
  private byKey = new Map<string, number>();
  private unlisteners: Array<() => void> = [];

  attach(bridge: WebviewBridge): void {
    this.detach();
    for (const name of DOWNLOAD_EVENT_NAMES) {
      const stop = listenDownload(bridge, name, (payload) => {
        this.handle(name, payload);
      });
      this.unlisteners.push(stop);
    }
  }

  detach(): void {
    for (const stop of this.unlisteners) stop();
    this.unlisteners = [];
  }

  clear(): void {
    this.entries = [];
    this.active = [];
    this.byKey.clear();
    for (const k of Object.keys(this.counts) as DownloadEventName[]) {
      this.counts[k] = 0;
    }
  }

  private log(event: string, payload: unknown, level: EventLogLevel): void {
    const entry: EventLogEntry = {
      id: (entryIdCounter += 1),
      ts: Date.now(),
      event,
      level,
      payload,
    };
    // Prepend + cap, returning a fresh array so $state propagates.
    const next = [entry, ...this.entries];
    if (next.length > EVENT_LOG_CAP) next.length = EVENT_LOG_CAP;
    this.entries = next;
  }

  // Replace a single active row by key with a freshly-built object so the
  // consumer always sees a new reference (immutable update = reliable reactivity).
  private replaceActive(key: string, build: (prev: ActiveDownload | undefined) => ActiveDownload): void {
    const prevIndex = this.byKey.get(key);
    const prev = prevIndex === undefined ? undefined : this.active[prevIndex];
    const next = build(prev);
    const arr = this.active.slice();
    if (prevIndex === undefined) {
      arr.unshift(next);
      // Rebuild index since every position shifted.
      this.byKey.clear();
      for (let i = 0; i < arr.length; i += 1) {
        this.byKey.set(arr[i]!.key, i);
      }
    } else {
      arr[prevIndex] = next;
    }
    this.active = arr;
  }

  private handle(
    event: DownloadEventName,
    payload:
      | DownloadStartedPayload
      | DownloadProgressPayload
      | DownloadCompletedPayload,
  ): void {
    this.counts = { ...this.counts, [event]: this.counts[event] + 1 };
    this.log(event, payload, levelFor(event));
    const key = keyFor(payload as DownloadStartedPayload);
    switch (event) {
      case "downloadstarted": {
        const started = payload as DownloadStartedPayload;
        this.replaceActive(key, () => ({
          key,
          url: started.url,
          filename: started.filename,
          suggestedFilename: started.suggestedFilename,
          receivedBytes: 0,
          totalBytes: null,
          status: "started",
          startedAt: Date.now(),
        }));
        break;
      }
      case "downloadprogress": {
        const progress = payload as DownloadProgressPayload;
        this.replaceActive(key, (prev) => ({
          ...(prev ?? {
            key,
            url: progress.url,
            filename: progress.filename,
            suggestedFilename: progress.suggestedFilename,
            receivedBytes: 0,
            totalBytes: null,
            status: "started" as const,
            startedAt: Date.now(),
          }),
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
          status: "progress",
        }));
        break;
      }
      case "downloadcompleted": {
        const completed = payload as DownloadCompletedPayload;
        this.replaceActive(key, (prev) => ({
          ...(prev ?? {
            key,
            url: completed.url,
            filename: completed.filename,
            suggestedFilename: completed.suggestedFilename,
            receivedBytes: 0,
            totalBytes: null,
            status: "started" as const,
            startedAt: Date.now(),
          }),
          status: "completed",
          success: completed.success,
          finishedAt: Date.now(),
        }));
        break;
      }
      case "downloadfailed":
      case "downloadcanceled": {
        const terminal = payload as DownloadStartedPayload;
        this.replaceActive(key, (prev) => ({
          ...(prev ?? {
            key,
            url: terminal.url,
            filename: terminal.filename,
            suggestedFilename: terminal.suggestedFilename,
            receivedBytes: 0,
            totalBytes: null,
            status: "started" as const,
            startedAt: Date.now(),
          }),
          status: event === "downloadfailed" ? "failed" : "canceled",
          finishedAt: Date.now(),
        }));
        break;
      }
    }
  }
}

export const downloadEvents = new DownloadEventStore();
