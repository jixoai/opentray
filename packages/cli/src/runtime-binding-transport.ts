import {
  PROTOCOL_VERSION,
  parseServerFrame,
  type ClientRequestFrame,
  type RequestId,
  type ServerFrame,
} from "@opentray/spec";

import type { OpenTrayConnection, OpenTrayEventFrame } from "./client";
import {
  loadOpenTrayRuntimeBinding,
  type OpenTrayRuntimeHost,
  type OpenTrayRuntimeBinding,
  type OpenTrayVisibleRuntime,
} from "./native-runtime";

export type RuntimeBindingTransportKind = "visible" | "headless";

export interface CreateRuntimeBindingTransportOptions {
  readonly kind?: RuntimeBindingTransportKind;
  readonly binding?: OpenTrayRuntimeBinding;
  readonly packageVersion?: string;
  readonly clientVersion?: string;
  readonly protocolVersion?: number;
  readonly appId?: string;
  readonly appName?: string;
}

export const createRuntimeBindingTransport = async ({
  binding,
  packageVersion = "0.0.0",
  clientVersion = packageVersion,
  protocolVersion = PROTOCOL_VERSION,
  appId,
  appName,
  kind = "visible",
}: CreateRuntimeBindingTransportOptions = {}): Promise<OpenTrayConnection> => {
  const resolvedBinding = binding ?? (await loadOpenTrayRuntimeBinding());
  const runtime =
    kind === "headless"
      ? createHeadlessRuntime(resolvedBinding, packageVersion, appId, appName)
      : createVisibleRuntime(resolvedBinding);
  const transport = new RuntimeBindingTransport(runtime);
  await transport.init(clientVersion, protocolVersion);
  return transport;
};

const createVisibleRuntime = (
  binding: OpenTrayRuntimeBinding
): OpenTrayVisibleRuntime => {
  if (binding.createVisibleRuntime === undefined) {
    throw new Error(
      "OpenTray runtime binding does not expose createVisibleRuntime()"
    );
  }
  return binding.createVisibleRuntime();
};

const createHeadlessRuntime = (
  binding: OpenTrayRuntimeBinding,
  packageVersion: string,
  appId: string | undefined,
  appName: string | undefined
): OpenTrayRuntimeHost => {
  if (binding.createHeadlessRuntime === undefined) {
    throw new Error(
      "OpenTray runtime binding does not expose createHeadlessRuntime()"
    );
  }
  return binding.createHeadlessRuntime(packageVersion, appId, appName);
};

type RuntimeFrameInvoker = (frameJson: string) => string[] | Promise<string[]>;

interface RuntimeBindingHost extends OpenTrayRuntimeHost {
  request: RuntimeFrameInvoker;
  pollEvents?(): string[] | Promise<string[]>;
}

class RuntimeBindingTransport implements OpenTrayConnection {
  private readonly listeners = new Set<(frame: OpenTrayEventFrame) => void>();
  private readonly runtime: RuntimeBindingHost;
  private readonly pollInterval: NodeJS.Timeout | undefined;

  constructor(runtime: RuntimeBindingHost) {
    this.runtime = runtime;
    this.pollInterval =
      runtime.pollEvents === undefined
        ? undefined
        : setInterval(() => {
            void this.pollRuntimeEvents().catch(() => {
              // Polling is an event ingress path. Request and close failures still surface to callers.
            });
          }, 50);
    this.pollInterval?.unref();
  }

  async init(clientVersion: string, protocolVersion: number): Promise<void> {
    const frames = await this.invoke({
      type: "init",
      protocolVersion,
      clientVersion,
    });
    const ready = frames.find(
      (frame): frame is Extract<ServerFrame, { type: "ready" }> =>
        frame.type === "ready"
    );
    if (ready === undefined) {
      throw new Error("OpenTray runtime binding did not return a ready frame");
    }
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    const frames = await this.invoke(frame);
    const response = frames.find(
      (candidate) => responseRequestId(candidate) === frame.requestId
    );
    if (response === undefined) {
      throw new Error(
        `OpenTray runtime binding did not return response for requestId: ${frame.requestId}`
      );
    }
    return response;
  }

  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.pollInterval !== undefined) {
      clearInterval(this.pollInterval);
    }
    const frames = await this.parseFrames(await this.runtime.close());
    this.dispatchEvents(frames);
  }

  private async invoke(frame: object): Promise<ServerFrame[]> {
    const frames = await this.parseFrames(
      await this.runtime.request(JSON.stringify(frame))
    );
    this.dispatchEvents(frames);
    return frames;
  }

  private async parseFrames(
    frameJson: string[] | Promise<string[]>
  ): Promise<ServerFrame[]> {
    const rawFrames = await frameJson;
    return rawFrames.map((raw) => {
      const parsed = parseServerFrame(raw);
      if (!parsed.ok || parsed.frame === undefined) {
        throw new Error(`${parsed.error ?? "invalid server frame"}: ${raw}`);
      }
      return parsed.frame;
    });
  }

  private dispatchEvents(frames: readonly ServerFrame[]): void {
    for (const frame of frames) {
      if (frame.type !== "event" && frame.type !== "ext-event") {
        continue;
      }
      for (const listener of this.listeners) {
        listener(frame);
      }
    }
  }

  private async pollRuntimeEvents(): Promise<void> {
    const pollEvents = this.runtime.pollEvents;
    if (pollEvents === undefined) {
      return;
    }
    const frames = await this.parseFrames(await pollEvents.call(this.runtime));
    this.dispatchEvents(frames);
  }
}

const responseRequestId = (frame: ServerFrame): RequestId | undefined => {
  switch (frame.type) {
    case "app-created":
    case "default-app":
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
