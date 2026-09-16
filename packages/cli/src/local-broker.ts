// Orthogonal intents (2026-07-21; original user requests: a normal install
// yields one coherent local runtime; the last app launch command is committed
// only after a successful broker handshake):
// 1. Resolve caller identity, endpoint, package graph, and stable Darwin bundle.
// 2. Start/reuse one compatible caller-scoped broker and validate its identity.
// 3. Own request/event transport and deterministic connection teardown.
// 4. Commit mutable Darwin launch state after runtime initialization succeeds.

import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

import {
  PROTOCOL_VERSION,
  brokerArtifactIdentityEquals,
  parseServerFrame,
  type BrokerArtifactIdentity,
  type BrokerEndpointIdentityOptions,
  type ClientRequestFrame,
  type ExtOperationPayload,
  type RequestId,
  type ServerFrame,
} from "@opentray/spec";
import type { OpenTrayAppBundleOptions, OpenTrayAppLaunchDescriptor } from "@opentray/packaging";
import {
  resolveDefaultDarwinAppBundlePath,
  convergeDarwinAppBundleIdentity,
  resolveOpenTrayPackageIdentity,
  updateDarwinAppLaunchDescriptor,
  type OpenTrayPackageIdentity,
} from "@opentray/packaging";

import type { OpenTrayTransport } from "./client";
import { resolveCallerLabel } from "./daemon/caller-label";
import { createNodeDaemonDriver, startDaemon, type DaemonDriver } from "./daemon/lifecycle";
import { readPackageVersion } from "./daemon/package-version";
import { resolveDaemonPaths } from "./daemon/paths";
import type { DaemonPaths } from "./daemon/paths";

const packageJsonUrl = new URL("../package.json", import.meta.url);

export type LocalRuntimeEventFrame = Extract<
  ServerFrame,
  { type: "event" | "app-event" | "ext-event" }
>;

/**
 * Transport-close sentinel every pending request rejects with when the
 * broker socket closes (the broker exits once its last session closes, so a
 * caller racing its own teardown against that exit sees this message).
 * Exported so the tray-handle destroy path can treat it as the desired end
 * state instead of a failure (P3.6 quit-path finding, 2026-09-12).
 */
export const BROKER_CONNECTION_CLOSED_MESSAGE = "broker connection closed";

/**
 * Generic transport-close rejection code for every pending deferred operation
 * (add-ext-dialog §5.1 frozen): the core client carries no extension-specific
 * branch. Extension facades map this shared code onto their public surface
 * (e.g. ext-dialog's `dialog_transport_closed`) — that mapping is facade work,
 * never core work.
 */
export const EXTENSION_TRANSPORT_CLOSED_CODE = "extension_transport_closed";

/**
 * Typed rejection every deferred operation settles with: the `error` payload
 * branch of an `ext-operation-terminal` frame, or the generic
 * `extension_transport_closed` rejection when the transport dies while an
 * operation is pending. Consumers match on `code`; the human `message` is not
 * a contract. `details` carries the wire error's structured payload when the
 * extension supplied one.
 */
export class ExtensionOperationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExtensionOperationError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

const extensionTransportClosedError = (cause: Error): ExtensionOperationError =>
  new ExtensionOperationError(
    EXTENSION_TRANSPORT_CLOSED_CODE,
    "the broker transport closed while a deferred extension operation was pending",
    { cause }
  );

export interface LocalBrokerClient extends OpenTrayTransport {
  readonly endpoint: string;
  readonly callerLabel: string;
  readonly sessionId: string;
  /**
   * Terminal connection-death state (D3, harden-lifecycle-ownership): true
   * once the broker socket errored or closed. Pending and future requests
   * reject; event delivery has stopped.
   */
  readonly connectionDead: boolean;
  /**
   * Terminal connection-death notification; fires exactly once, either for a
   * transport error or the transport-close sentinel, and also after a
   * caller-initiated graceful `close()` completes.
   */
  onConnectionDead(listener: (error: Error) => void): () => void;
  onEvent(listener: (frame: LocalRuntimeEventFrame) => void): () => void;
  close(): Promise<void>;
}

export interface ConnectLocalBrokerOptions extends Partial<BrokerEndpointIdentityOptions> {
  endpoint?: string;
  homeDir?: string;
  appId?: string;
  appName?: string;
  clientVersion?: string;
  autoStart?: boolean;
  daemonDriver?: DaemonDriver;
  cliEntrypoint?: string;
  callerLabel?: string;
  expectedBrokerArtifactIdentity?: BrokerArtifactIdentity;
  appIcon?: import("@opentray/spec").AppIcon;
  appBundle?: OpenTrayAppBundleOptions;
  appLaunch?: OpenTrayAppLaunchDescriptor;
  packageName?: string;
  packageRoot?: string;
}

interface PendingRequest {
  resolve(frame: ServerFrame): void;
  reject(error: Error): void;
  /**
   * Set when the matching `ext-command-accepted` frame arrives (add-ext-dialog
   * §5.1 pending-until-final): the promise stays pending until exactly one
   * `ext-operation-terminal` settles it, and a transport death rejects it with
   * the generic typed `extension_transport_closed` instead of the plain
   * transport sentinel.
   */
  deferredOperation?: string;
}

interface BrokerSocket {
  setEncoding(encoding: BufferEncoding): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
  once(event: "connect", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  write(data: string): void;
  end(callback: () => void): void;
}

export const connectLocalBroker = async (
  options: ConnectLocalBrokerOptions = {},
): Promise<LocalBrokerClient> => {
  const packageVersion = options.packageVersion ?? (await readPackageVersion(packageJsonUrl));
  const clientVersion = options.clientVersion ?? packageVersion;
  const appId = normalizeAppIdentityField(options.appId);
  const appName = normalizeAppIdentityField(options.appName);
  // Endpoint identity precedence (D4, harden-lifecycle-ownership): internal
  // diagnostic override > appId slug > tool fallbacks. `appName` never
  // participates: display names are not filesystem-safe endpoint segments.
  const callerLabel =
    options.callerLabel ?? resolveCallerLabel(appId === undefined ? {} : { appId });
  const paths = resolveDaemonPaths({
    homeDir: options.homeDir ?? process.env.OPENTRAY_HOME ?? homedir(),
    packageVersion,
    callerLabel,
    ...(appId === undefined ? {} : { appId }),
    ...(appName === undefined ? {} : { appName }),
  });
  const endpoint = options.endpoint ?? paths.endpoint;
  const autoStart = options.autoStart ?? endpoint === paths.endpoint;
  if (autoStart && endpoint !== paths.endpoint) {
    throw new Error("local broker autoStart requires the derived same-version endpoint");
  }
  const cliEntrypoint = options.cliEntrypoint ?? resolveCliEntrypoint();
  const packageIdentity =
    process.platform === "darwin" && autoStart
      ? await resolveOpenTrayPackageIdentity({
          ...(options.packageName === undefined ? {} : { packageName: options.packageName }),
          ...(options.packageRoot === undefined ? {} : { packageRoot: options.packageRoot }),
        })
      : undefined;
  const appBundle =
    process.platform === "darwin" && autoStart
      ? resolveDarwinAppBundleOptions(options.appBundle, paths, packageIdentity)
      : undefined;
  const driver =
    options.daemonDriver ??
    createNodeDaemonDriver(cliEntrypoint, {
      ...(appBundle === undefined ? {} : { appBundle }),
      ...(options.appIcon === undefined ? {} : { appIcon: options.appIcon }),
      ...(packageIdentity === undefined ? {} : { packageIdentity }),
    });
  const expectedBrokerArtifactIdentity = autoStart
    ? (await startDaemon({ paths, driver })).broker.artifactIdentity
    : (options.expectedBrokerArtifactIdentity ??
      (await driver.resolveBroker(paths)).artifactIdentity);
  const socket = await connectSocket(endpoint);
  const connection = new LocalBrokerConnection(socket, endpoint, callerLabel);

  try {
    await connection.init(
      clientVersion,
      options.protocolVersion ?? PROTOCOL_VERSION,
      expectedBrokerArtifactIdentity,
    );
    if (appBundle !== undefined && options.appLaunch !== undefined) {
      await updateDarwinAppLaunchDescriptor(appBundle.path, options.appLaunch);
      const convergence = await convergeDarwinAppBundleIdentity({
        currentBundlePath: appBundle.path,
        appId: paths.appId,
        managedAppsRoot: resolve(paths.homeDir, ".opentray/apps"),
        legacyRuntimeRoot: resolve(paths.homeDir, ".opentray"),
        legacyBundlePaths: [resolve(paths.runtimeDir, "darwin-carrier/OpenTray.app")],
      });
      await appendBrokerDiagnostic(paths.brokerLog, {
        event: "bundle-identity-convergence",
        removed: convergence.removed,
        skippedLiveOwner: convergence.skippedLiveOwner,
        failedUnregister: convergence.failedUnregister,
      });
    }
  } catch (error) {
    await connection.close();
    throw error;
  }
  return connection;
};

const appendBrokerDiagnostic = async (
  path: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> => {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(
      path,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...value })}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never turn a successful tray connection into a failure.
  }
};

const resolveDarwinAppBundleOptions = (
  configured: OpenTrayAppBundleOptions | undefined,
  paths: DaemonPaths,
  packageIdentity: OpenTrayPackageIdentity | undefined,
): OpenTrayAppBundleOptions & { readonly path: string } => {
  if (packageIdentity === undefined) {
    throw new Error("Darwin app bundle resolution requires the caller package identity");
  }
  const configuredPath = configured?.path;
  const path =
    configuredPath === undefined
      ? resolveDefaultDarwinAppBundlePath({
          homeDir: paths.homeDir,
          packageName: packageIdentity.name,
          appName: paths.appName,
        })
      : typeof configuredPath === "string"
        ? isAbsolute(configuredPath)
          ? configuredPath
          : resolve(packageIdentity.root, configuredPath)
        : configuredPath.protocol === "file:"
          ? fileURLToPath(configuredPath)
          : (() => {
              throw new Error(`Darwin appBundle.path must be a file URL: ${configuredPath.href}`);
            })();
  return {
    path,
    ...(configured?.reinitialize === undefined ? {} : { reinitialize: configured.reinitialize }),
  };
};

const normalizeAppIdentityField = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

class LocalBrokerConnection implements LocalBrokerClient {
  readonly endpoint: string;
  readonly callerLabel: string;
  sessionId = "";

  private buffer = "";
  private readonly listeners = new Set<(frame: LocalRuntimeEventFrame) => void>();
  private readonly pending = new Map<RequestId, PendingRequest>();
  /** operationId -> requestId of accepted-but-unsettled deferred operations. */
  private readonly deferredOperations = new Map<string, RequestId>();
  private readonly deadListeners = new Set<(error: Error) => void>();
  private deadError: Error | undefined;
  private ready:
    | {
        resolve(frame: Extract<ServerFrame, { type: "ready" }>): void;
        reject(error: Error): void;
      }
    | undefined;

  constructor(
    private readonly socket: BrokerSocket,
    endpoint: string,
    callerLabel: string,
  ) {
    this.endpoint = endpoint;
    this.callerLabel = callerLabel;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      this.consume(String(chunk));
    });
    socket.on("error", (error) => {
      // Transport errors race the close event per platform (Linux delivers
      // ECONNRESET before close; macOS close-first). The terminal surface is
      // the stable classification message — the underlying transport error
      // stays observable as `cause` for diagnostics, so both orderings
      // expose identical public behavior.
      this.markDead(
        new Error(BROKER_CONNECTION_CLOSED_MESSAGE, { cause: error }),
      );
    });
    socket.on("close", () => {
      this.markDead(new Error(BROKER_CONNECTION_CLOSED_MESSAGE));
    });
  }

  get connectionDead(): boolean {
    return this.deadError !== undefined;
  }

  onConnectionDead(listener: (error: Error) => void): () => void {
    this.deadListeners.add(listener);
    return () => {
      this.deadListeners.delete(listener);
    };
  }

  async init(
    clientVersion: string,
    protocolVersion: number,
    expectedBrokerArtifactIdentity: BrokerArtifactIdentity,
  ): Promise<void> {
    const ready = new Promise<Extract<ServerFrame, { type: "ready" }>>((resolve, reject) => {
      this.ready = { resolve, reject };
    });
    this.write({
      type: "init",
      protocolVersion,
      clientVersion,
    });
    const frame = await ready;
    if (
      !brokerArtifactIdentityEquals(frame.brokerArtifactIdentity, expectedBrokerArtifactIdentity)
    ) {
      throw new Error(
        `broker artifact identity mismatch: expected=${JSON.stringify(expectedBrokerArtifactIdentity)} actual=${JSON.stringify(frame.brokerArtifactIdentity)}`,
      );
    }
    this.sessionId = frame.sessionId;
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    if (this.pending.has(frame.requestId)) {
      throw new Error(`duplicate requestId: ${frame.requestId}`);
    }
    // Requests issued after transport death reject immediately: a destroyed
    // socket swallows writes without a terminal event, so the request map
    // would otherwise hold them forever (F2 zombie-entry finding, 2026-09-14:
    // post-death getUrl/destroy stayed pending indefinitely in both Node and
    // Bun because write-after-close only returns false).
    if (this.deadError !== undefined) {
      throw new Error(this.deadError.message);
    }

    const response = new Promise<ServerFrame>((resolve, reject) => {
      this.pending.set(frame.requestId, { resolve, reject });
    });
    this.write(frame);
    return response;
  }

  onEvent(listener: (frame: LocalRuntimeEventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.deadError !== undefined) {
      // The transport already reached its terminal state; there is nothing
      // left to end. Resolving keeps explicit teardown paths (e.g. generated
      // app Quit after broker death) finite.
      return;
    }
    this.write({ type: "exit" });
    await new Promise<void>((resolve) => {
      this.socket.end(resolve);
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }

      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.dispatchLine(line);
      }
    }
  }

  private dispatchLine(line: string): void {
    const parsed = parseServerFrame(line);
    if (!parsed.ok || parsed.frame === undefined) {
      this.rejectAll(new Error(`${parsed.error ?? "invalid server frame"}: ${line}`));
      return;
    }

    this.dispatchFrame(parsed.frame);
  }

  private dispatchFrame(frame: ServerFrame): void {
    if (frame.type === "ready") {
      this.ready?.resolve(frame);
      this.ready = undefined;
      return;
    }

    if (frame.type === "error") {
      const error = new Error(`${frame.code}: ${frame.message}`);
      if (frame.requestId !== undefined) {
        this.pending.get(frame.requestId)?.reject(error);
        this.pending.delete(frame.requestId);
        return;
      }
      // An error with no requestId could not be correlated to a specific request.
      // If the handshake is still pending, reject it; otherwise reject every
      // pending request so callers fail loudly instead of hanging indefinitely.
      // (See issue #3: createTray never resolves on a malformed frame.)
      if (this.ready) {
        this.ready.reject(error);
        this.ready = undefined;
        return;
      }
      this.rejectAll(error);
      return;
    }

    if (frame.type === "ext-command-accepted") {
      this.acceptDeferredOperation(frame.requestId, frame.operationId);
      return;
    }

    if (frame.type === "ext-operation-terminal") {
      this.settleDeferredOperation(frame.operationId, frame.payload);
      return;
    }

    const requestId = responseRequestId(frame);
    if (requestId !== undefined) {
      // Request responses and broker events are separate streams even on one socket.
      this.pending.get(requestId)?.resolve(frame);
      this.pending.delete(requestId);
      return;
    }

    if (
      frame.type === "event" ||
      frame.type === "app-event" ||
      frame.type === "ext-event"
    ) {
      for (const listener of this.listeners) {
        listener(frame);
      }
    }
  }

  private write(frame: unknown): void {
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  /**
   * Pending-until-final acceptance (add-ext-dialog §5.1): acceptance never
   * settles the request. The broker's owner loop guarantees exactly one
   * terminal per operation; a second acceptance for the same request or an
   * already-bound operationId is defensively ignored, never a second
   * registration.
   */
  private acceptDeferredOperation(requestId: RequestId, operationId: string): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.deferredOperation !== undefined) {
      return;
    }
    if (this.deferredOperations.has(operationId)) {
      return;
    }
    entry.deferredOperation = operationId;
    this.deferredOperations.set(operationId, requestId);
  }

  /**
   * The single terminal settlement: resolves the still-pending request with
   * the terminal frame (`payload.kind === "result"`), or rejects it with the
   * typed wire error (`"error"`). Terminals for unknown or already-settled
   * operationIds are silently dropped — the broker side already settles
   * through a one-shot CAS; the client mirrors that stateless drop instead of
   * guessing an owner.
   */
  private settleDeferredOperation(operationId: string, payload: ExtOperationPayload): void {
    const requestId = this.deferredOperations.get(operationId);
    if (requestId === undefined) {
      return;
    }
    const entry = this.pending.get(requestId);
    this.deferredOperations.delete(operationId);
    this.pending.delete(requestId);
    if (entry === undefined) {
      return;
    }
    if (payload.kind === "result") {
      // The terminal frame is the correlated server-frame settlement of the
      // original request; its payload carries the deferred value.
      const terminal: Extract<ServerFrame, { type: "ext-operation-terminal" }> = {
        type: "ext-operation-terminal",
        operationId,
        payload,
      };
      entry.resolve(terminal);
      return;
    }
    const wireError = payload.error;
    entry.reject(
      new ExtensionOperationError(wireError.code, wireError.message, {
        details: wireError.details,
      }),
    );
  }

  private rejectAll(error: Error): void {
    this.ready?.reject(error);
    this.ready = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.deferredOperations.clear();
  }

  /**
   * Terminal connection-death transition (D3): first socket error/close wins,
   * rejects everything pending, and notifies every terminal listener exactly
   * once. Later terminal events are no-ops.
   *
   * Pending-until-final (add-ext-dialog §5.1): accepted deferred operations
   * reject with the generic typed `extension_transport_closed` (the core
   * client has no extension-name branch); every ordinary pending request
   * keeps the plain transport sentinel.
   */
  private markDead(error: Error): void {
    if (this.deadError !== undefined) {
      return;
    }
    this.deadError = error;
    this.ready?.reject(error);
    this.ready = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(
        pending.deferredOperation === undefined ? error : extensionTransportClosedError(error),
      );
    }
    this.pending.clear();
    this.deferredOperations.clear();
    for (const listener of [...this.deadListeners]) {
      try {
        listener(error);
      } catch {
        // A throwing terminal listener must not block death propagation to
        // the remaining listeners.
      }
    }
  }
}

const connectSocket = (endpoint: string): Promise<BrokerSocket> =>
  new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });

const responseRequestId = (frame: ServerFrame): RequestId | undefined => {
  switch (frame.type) {
    case "app-created":
    case "default-app":
    case "app-identity":
    case "tray-created":
    case "tray-bounds":
    case "ack":
    case "ext-command-result":
    case "runtime-host-health":
      return frame.requestId;
    // Acceptance never settles a request (handled before correlation), and a
    // terminal frame carries no requestId at all: both are routed through the
    // deferred-operation map in `dispatchFrame`.
    case "ext-command-accepted":
    case "ext-operation-terminal":
    case "ready":
    case "event":
    case "app-event":
    case "ext-event":
    case "error":
      return undefined;
  }
};

const resolveCliEntrypoint = (): string => {
  const suffix = fileURLToPath(import.meta.url).endsWith(".ts") ? "cli.ts" : "cli.mjs";
  return fileURLToPath(new URL(`./${suffix}`, import.meta.url));
};
