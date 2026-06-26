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
  type OpenTrayRuntimeBinding,
} from "./native-runtime";

export interface CreateRuntimeBindingTransportOptions {
  readonly binding?: OpenTrayRuntimeBinding;
  readonly packageVersion?: string;
  readonly clientVersion?: string;
  readonly protocolVersion?: number;
}

export const createRuntimeBindingTransport = async ({
  binding,
  packageVersion = "0.0.0",
  clientVersion = packageVersion,
  protocolVersion = PROTOCOL_VERSION,
}: CreateRuntimeBindingTransportOptions = {}): Promise<OpenTrayConnection> => {
  const resolvedBinding = binding ?? (await loadOpenTrayRuntimeBinding());
  if (resolvedBinding.createHeadlessRuntime === undefined) {
    throw new Error(
      "OpenTray runtime binding does not expose createHeadlessRuntime()"
    );
  }
  const runtime = resolvedBinding.createHeadlessRuntime(packageVersion);
  const transport = new RuntimeBindingTransport(runtime);
  await transport.init(clientVersion, protocolVersion);
  return transport;
};

type RuntimeFrameInvoker = (frameJson: string) => string[] | Promise<string[]>;

interface RuntimeBindingHost {
  request: RuntimeFrameInvoker;
  close(): string[] | Promise<string[]>;
}

class RuntimeBindingTransport implements OpenTrayConnection {
  private readonly listeners = new Set<(frame: OpenTrayEventFrame) => void>();

  constructor(private readonly runtime: RuntimeBindingHost) {}

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
}

const responseRequestId = (frame: ServerFrame): RequestId | undefined => {
  switch (frame.type) {
    case "app-created":
    case "default-app":
    case "tray-created":
    case "tray-bounds":
    case "ack":
    case "ext-command-result":
    case "daemon-health":
      return frame.requestId;
    case "ready":
    case "event":
    case "ext-event":
    case "error":
      return undefined;
  }
};
