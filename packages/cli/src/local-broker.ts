import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

import {
  PROTOCOL_VERSION,
  brokerArtifactIdentityEquals,
  parseServerFrame,
  type BrokerArtifactIdentity,
  type BrokerEndpointIdentityOptions,
  type ClientRequestFrame,
  type RequestId,
  type ServerFrame,
} from "@opentray/spec";
import type { OpenTrayAppBundleOptions } from "@opentray/packaging";
import {
  resolveDefaultDarwinAppBundlePath,
  resolveOpenTrayPackageIdentity,
  type OpenTrayPackageIdentity,
} from "@opentray/packaging";

import type { OpenTrayTransport } from "./client";
import { resolveCallerLabel } from "./daemon/caller-label";
import {
  createNodeDaemonDriver,
  startDaemon,
  type DaemonDriver,
} from "./daemon/lifecycle";
import { readPackageVersion } from "./daemon/package-version";
import { resolveDaemonPaths } from "./daemon/paths";
import type { DaemonPaths } from "./daemon/paths";

const packageJsonUrl = new URL("../package.json", import.meta.url);

export type LocalRuntimeEventFrame = Extract<
  ServerFrame,
  { type: "event" | "ext-event" }
>;

export interface LocalBrokerClient extends OpenTrayTransport {
  readonly endpoint: string;
  readonly callerLabel: string;
  readonly sessionId: string;
  onEvent(listener: (frame: LocalRuntimeEventFrame) => void): () => void;
  close(): Promise<void>;
}

export interface ConnectLocalBrokerOptions
  extends Partial<BrokerEndpointIdentityOptions> {
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
  packageName?: string;
  packageRoot?: string;
}

interface PendingRequest {
  resolve(frame: ServerFrame): void;
  reject(error: Error): void;
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
  options: ConnectLocalBrokerOptions = {}
): Promise<LocalBrokerClient> => {
  const packageVersion =
    options.packageVersion ?? (await readPackageVersion(packageJsonUrl));
  const clientVersion = options.clientVersion ?? packageVersion;
  const appId = normalizeAppIdentityField(options.appId);
  const appName = normalizeAppIdentityField(options.appName);
  const callerLabel =
    options.callerLabel ?? appName ?? appId ?? resolveCallerLabel();
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
    throw new Error(
      "local broker autoStart requires the derived same-version endpoint"
    );
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
    : options.expectedBrokerArtifactIdentity ??
      (await driver.resolveBroker(paths)).artifactIdentity;
  const socket = await connectSocket(endpoint);
  const connection = new LocalBrokerConnection(socket, endpoint, callerLabel);

  try {
    await connection.init(
      clientVersion,
      options.protocolVersion ?? PROTOCOL_VERSION,
      expectedBrokerArtifactIdentity,
    );
  } catch (error) {
    await connection.close();
    throw error;
  }
  return connection;
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

const normalizeAppIdentityField = (
  value: string | undefined
): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

class LocalBrokerConnection implements LocalBrokerClient {
  readonly endpoint: string;
  readonly callerLabel: string;
  sessionId = "";

  private buffer = "";
  private readonly listeners = new Set<
    (frame: LocalRuntimeEventFrame) => void
  >();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private ready:
    | {
        resolve(frame: Extract<ServerFrame, { type: "ready" }>): void;
        reject(error: Error): void;
      }
    | undefined;

  constructor(
    private readonly socket: BrokerSocket,
    endpoint: string,
    callerLabel: string
  ) {
    this.endpoint = endpoint;
    this.callerLabel = callerLabel;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      this.consume(String(chunk));
    });
    socket.on("error", (error) => {
      this.rejectAll(error);
    });
    socket.on("close", () => {
      this.rejectAll(new Error("broker connection closed"));
    });
  }

  async init(
    clientVersion: string,
    protocolVersion: number,
    expectedBrokerArtifactIdentity: BrokerArtifactIdentity,
  ): Promise<void> {
    const ready = new Promise<Extract<ServerFrame, { type: "ready" }>>(
      (resolve, reject) => {
        this.ready = { resolve, reject };
      }
    );
    this.write({
      type: "init",
      protocolVersion,
      clientVersion,
    });
    const frame = await ready;
    if (
      !brokerArtifactIdentityEquals(
        frame.brokerArtifactIdentity,
        expectedBrokerArtifactIdentity,
      )
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
      this.rejectAll(
        new Error(`${parsed.error ?? "invalid server frame"}: ${line}`)
      );
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

    const requestId = responseRequestId(frame);
    if (requestId !== undefined) {
      // Request responses and broker events are separate streams even on one socket.
      this.pending.get(requestId)?.resolve(frame);
      this.pending.delete(requestId);
      return;
    }

    if (frame.type === "event" || frame.type === "ext-event") {
      for (const listener of this.listeners) {
        listener(frame);
      }
    }
  }

  private write(frame: unknown): void {
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  private rejectAll(error: Error): void {
    this.ready?.reject(error);
    this.ready = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
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
    case "ready":
    case "event":
    case "ext-event":
    case "error":
      return undefined;
  }
};

const resolveCliEntrypoint = (): string => {
  const suffix = fileURLToPath(import.meta.url).endsWith(".ts")
    ? "cli.ts"
    : "cli.mjs";
  return fileURLToPath(new URL(`./${suffix}`, import.meta.url));
};
