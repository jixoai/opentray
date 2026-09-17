import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BrokerServerError,
  createBrokerEndpointIdentity,
  createInitFrame,
  createClient,
  createTrayHandle,
  ExtensionOperationError,
  formatBrokerEndpointName,
  PROTOCOL_VERSION,
  type ClientRequestFrame,
  type ExtOperationPayload,
  type OpenTrayTransport,
  type OpenTrayConnection,
  type OpenTrayEventFrame,
  type NativeExtensionExpectedIdentity,
  type ServerFrame,
} from "./index";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "identity",
  artifactSetVersion: "test",
  contractFingerprint: "identity-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;

describe("opentray client", () => {
  it("routes extension commands through public protocol", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    await tray.commandExtension("webview", {
      type: "show",
      width: 320,
      height: 240,
    });

    expect(transport.frames).toEqual([
      {
        type: "ext-command",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: { type: "show", width: 320, height: 240 },
      },
    ]);
  });

  it("settles a deferred request with the terminal result value (public terminal contract)", async () => {
    const transport = new DeferredTerminalTransport({
      kind: "result",
      value: { response: 1, suppressed: false },
    });
    const tray = createTrayHandle(transport, "app-1", "tray-1", createTestRequestId);

    const result = await tray.requestExtension("dialog", { type: "show" });

    expect(result).toEqual({
      kind: "terminal",
      operationId: "0000000000000001",
      value: { response: 1, suppressed: false },
    });
    if (result.kind !== "terminal") {
      throw new Error("expected a terminal result");
    }
    // Batch C facades consume exactly this field.
    expect(result.value).toEqual({ response: 1, suppressed: false });
  });

  it("rejects a deferred request with the typed terminal error", async () => {
    const transport = new DeferredTerminalTransport({
      kind: "error",
      error: {
        code: "dialog_dismissal_unavailable",
        message: "platform cannot observe the dismissal reason",
        details: { kind: "dismissal" },
      },
    });
    const tray = createTrayHandle(transport, "app-1", "tray-1", createTestRequestId);

    const error = await tray.requestExtension("dialog", { type: "show" }).then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(error).toBeInstanceOf(ExtensionOperationError);
    expect(error).toBeInstanceOf(Error);
    const typed = error as ExtensionOperationError;
    expect(typed.code).toBe("dialog_dismissal_unavailable");
    expect(typed.message).toBe("platform cannot observe the dismissal reason");
    expect(typed.details).toEqual({ kind: "dismissal" });
  });

  it("returns immediate envelopes through the public request contract", async () => {
    const eventsTransport = new ImmediateEventsTransport();
    const eventsTray = createTrayHandle(
      eventsTransport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    await expect(
      eventsTray.requestExtension("webview", { type: "list" })
    ).resolves.toEqual({
      kind: "immediate",
      events: [
        {
          scope: { appId: "app-1", trayId: "tray-1", ext: "webview" },
          data: { type: "views", count: 1 },
        },
      ],
    });

    // The plain ack arm settles as an immediate result with no envelopes.
    const ackTray = createTrayHandle(
      new RecordingTransport(),
      "app-1",
      "tray-1",
      createTestRequestId
    );
    await expect(
      ackTray.requestExtension("webview", { type: "show" })
    ).resolves.toEqual({ kind: "immediate", events: [] });
  });

  it("rejects a synchronous correlated server error with the typed error contract", async () => {
    const transport = new SyncErrorTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1", createTestRequestId);

    const withDetails = await tray.requestExtension("dialog", { type: "show" }).then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(withDetails).toBeInstanceOf(BrokerServerError);
    expect(withDetails).toBeInstanceOf(Error);
    const typed = withDetails as BrokerServerError;
    expect(typed.name).toBe("BrokerServerError");
    expect(typed.code).toBe("dialog_presentation_failed");
    expect(typed.message).toBe("worker did not reach the native modal call");
    expect(typed.details).toEqual({ worker: "owner-1", phase: "enter-modal" });

    // A details-free synchronous error stays typed with `details` absent
    // (never null): codes without structured detail omit the field.
    const withoutDetails = await tray.requestExtension("dialog", { type: "show" }).then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(withoutDetails).toBeInstanceOf(BrokerServerError);
    const bare = withoutDetails as BrokerServerError;
    expect(bare.code).toBe("dialog_worker_limit_reached");
    expect(bare.details).toBeUndefined();
  });

  it("passes app and tray identity into extension context", () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    const extended = tray.extend({
      name: "identity",
      artifact: {
        kind: "file",
        path: "/tmp/example-identity",
        expectedIdentity: TEST_EXPECTED_IDENTITY,
      },
      extend(_tray, context) {
        return {
          appId: context.appId,
          trayId: context.trayId,
          mountId: context.mountId,
        };
      },
    });

    expect(extended.appId).toBe("app-1");
    expect(extended.trayId).toBe("tray-1");
    expect(extended.mountId).toBe("identity.tray-1.1");
  });

  it("resolves a native artifact from the facade dependency closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-artifact-resolution-"));
    const facadePackageJson = join(
      root,
      "node_modules/.pnpm/facade/node_modules/@fixture/ext/package.json"
    );
    const contractManifest = join(dirname(facadePackageJson), "contract.json");
    const nestedPlatformPackageJson = join(
      root,
      "node_modules/.pnpm/facade/node_modules/@fixture/ext-platform/package.json"
    );
    const nestedLibrary = join(dirname(nestedPlatformPackageJson), "lib/native.dylib");
    const orphanPlatformPackageJson = join(
      root,
      "node_modules/@fixture/ext-platform/package.json"
    );
    await writeJson(facadePackageJson, {
      name: "@fixture/ext",
      version: "2.0.0",
    });
    await writeJson(contractManifest, {
      extensionName: "fixture",
      contractFingerprint: "fixture-contract-2",
    });
    await writeJson(nestedPlatformPackageJson, {
      name: "@fixture/ext-platform",
      version: "2.0.0",
      os: [process.platform],
      cpu: [process.arch],
    });
    await writeFileAt(nestedLibrary, "current");
    await writeJson(orphanPlatformPackageJson, {
      name: "@fixture/ext-platform",
      version: "1.0.0",
      os: [process.platform],
      cpu: [process.arch],
    });
    await writeFileAt(join(dirname(orphanPlatformPackageJson), "lib/native.dylib"), "orphan");

    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1", createTestRequestId);
    const target = `${process.platform}-${process.arch}`;
    const extension = tray.extend({
      name: "fixture",
      artifact: {
        kind: "package",
        packageJsonUrl: pathToFileURL(facadePackageJson).href,
        contractManifestUrl: pathToFileURL(contractManifest).href,
        targets: {
          [target]: {
            packageName: "@fixture/ext-platform",
            libraryPath: "lib/native.dylib",
          },
        },
      },
      extend(_tray, context) {
        return { load: () => context.ensureLoaded() };
      },
    });

    await extension.load();

    expect(transport.frames[0]).toMatchObject({
      type: "load-ext",
      path: await realpath(nestedLibrary),
      expectedIdentity: {
        extensionName: "fixture",
        artifactSetVersion: "2.0.0",
        contractFingerprint: "fixture-contract-2",
        target: {
          os: process.platform,
          arch: process.arch,
        },
      },
    });
  });

  it("rejects a missing target package before broker dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "opentray-artifact-missing-"));
    const facadePackageJson = join(root, "node_modules/@fixture/ext/package.json");
    const contractManifest = join(dirname(facadePackageJson), "contract.json");
    await writeJson(facadePackageJson, {
      name: "@fixture/ext",
      version: "2.0.0",
    });
    await writeJson(contractManifest, {
      extensionName: "fixture",
      contractFingerprint: "fixture-contract-2",
    });
    const packageJsonUrl = pathToFileURL(facadePackageJson).href;
    const target = `${process.platform}-${process.arch}`;
    const transport = new RecordingTransport();
    const tray = createTrayHandle(transport, "app-1", "tray-1", createTestRequestId);
    const extension = tray.extend({
      name: "fixture",
      artifact: {
        kind: "package",
        packageJsonUrl,
        contractManifestUrl: pathToFileURL(contractManifest).href,
        targets: {
          [target]: {
            packageName: "@fixture/missing-platform",
            libraryPath: "lib/native.dylib",
          },
        },
      },
      extend(_tray, context) {
        return { load: () => context.ensureLoaded() };
      },
    });

    await expect(extension.load()).rejects.toMatchObject({
      code: "OPENTRAY_NATIVE_EXTENSION_ARTIFACT_RESOLUTION_FAILED",
      target,
      packageName: "@fixture/missing-platform",
      facadePackageJsonUrl: packageJsonUrl,
    });
    expect(transport.frames).toEqual([]);
  });

  it("queries tray bounds through the runtime-bound tray handle", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    const bounds = await tray.getBounds();

    expect(bounds).toEqual({
      kind: "native",
      source: "backend.nativeTrayBounds",
      rect: { x: 10, y: 20, width: 24, height: 24 },
    });
    expect(transport.frames).toEqual([
      {
        type: "get-tray-bounds",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
      },
    ]);
  });

  it("updates tray state through tray-scoped protocol requests", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    await tray.setMenu({ items: [{ type: "item", id: 1, title: "Open" }] });
    await tray.setTooltip({ title: "Focus", description: "25 minutes" });
    await tray.setIcon({
      type: "rgba",
      data: [0, 0, 0, 0],
      width: 1,
      height: 1,
    });

    expect(transport.frames).toEqual([
      {
        type: "set-tray-menu",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        menu: { items: [{ type: "item", id: 1, title: "Open" }] },
      },
      {
        type: "set-tray-tooltip",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        tooltip: { title: "Focus", description: "25 minutes" },
      },
      {
        type: "set-tray-icon",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
      },
    ]);
  });

  it("exposes tray-scoped events only for eventful broker connections", () => {
    const transport = new EventfulRecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );
    const seen: string[] = [];

    const unsubscribeMenu = tray.onMenuClick((event) => {
      seen.push(`menu:${event.itemId}`);
    });
    const unsubscribeClick = tray.onTrayClick((event) => {
      seen.push(`click:${event.x},${event.y}`);
    });
    const unsubscribeReopen = tray.onAppReopenRequested(() => {
      seen.push("app:reopen");
    });

    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "other", itemId: 1 },
    });
    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "tray-1", itemId: 2 },
    });
    transport.emit({
      type: "event",
      event: {
        type: "trayClick",
        appId: "app-1",
        trayId: "tray-1",
        button: "left",
        x: 4,
        y: 8,
      },
    });
    transport.emit({
      type: "ext-event",
      appId: "app-1",
      trayId: "tray-1",
      ext: "webview",
      data: {},
    });
    transport.emit({
      type: "app-event",
      event: { type: "reopenRequested", appId: "other-app" },
    });
    transport.emit({
      type: "app-event",
      event: { type: "reopenRequested", appId: "app-1" },
    });

    unsubscribeMenu();
    unsubscribeClick();
    unsubscribeReopen();
    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "tray-1", itemId: 3 },
    });

    expect(seen).toEqual(["menu:2", "click:4,8", "app:reopen"]);
  });

  it("creates explicit protocol handshake frames", () => {
    expect(createInitFrame("0.1.0")).toEqual({
      type: "init",
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: "0.1.0",
    });
  });

  it("resolves broker-created app and tray identities", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "test" });

    const tray = await client.createTray({
      id: "status",
      icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
    });

    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual([
      "test-1",
      "test-2",
    ]);
  });

  it("creates a tray through the client default app lookup", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "alias" });

    const tray = await client.createTray({ id: "legacy" });

    expect(tray.trayId).toBe("legacy");
    expect(transport.frames).toEqual([
      { type: "resolve-default-app", requestId: "alias-1" },
      {
        type: "create-tray",
        requestId: "alias-2",
        app: { appId: "app-default" },
        tray: { id: "legacy" },
      },
    ]);
  });

  it("exposes versioned broker endpoint identity helpers", () => {
    const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });

    expect(formatBrokerEndpointName(identity)).toBe(
      "opentray-0.1.0-p2-opentray"
    );
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    switch (frame.type) {
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          appId: frame.app.appId,
          trayId: frame.tray.id,
        };
      case "resolve-default-app":
        return {
          type: "default-app",
          requestId: frame.requestId,
          app: {
            appId: "app-default",
          },
        };
      case "get-app-identity":
        return {
          type: "app-identity",
          requestId: frame.requestId,
          identity: { appId: frame.appId, appName: frame.appId },
        };
      case "set-app-name":
      case "set-app-icon":
      case "set-app-icon-variant":
        return { type: "ack", requestId: frame.requestId };
      case "destroy-tray":
        return { type: "ack", requestId: frame.requestId };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          appId: frame.appId,
          trayId: frame.trayId,
          bounds: {
            kind: "native",
            source: "backend.nativeTrayBounds",
            rect: { x: 10, y: 20, width: 24, height: 24 },
          },
        };
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
        return { type: "ack", requestId: frame.requestId };
      case "health":
        return {
          type: "runtime-host-health",
          requestId: frame.requestId,
          health: {
            pid: 12345,
            endpoint: "recorded",
            packageVersion: "0.1.0",
            protocolVersion: PROTOCOL_VERSION,
            appId: "com.example.test-runtime",
            appName: "Test Runtime",
            callerLabel: "test-runtime",
            sessionCount: 0,
            sessions: [],
          },
        };
      default:
        return {
          type: "error",
          requestId: frame.requestId,
          code: "unsupported",
          message: frame.type,
        };
    }
  }
}

class EventfulRecordingTransport
  extends RecordingTransport
  implements OpenTrayConnection
{
  private readonly listeners = new Set<(frame: OpenTrayEventFrame) => void>();

  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(frame: OpenTrayEventFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }
}

/**
 * Mirrors the local broker connection's deferred settlement: a result
 * terminal resolves the pending request with the terminal frame itself; an
 * error terminal rejects with the typed ExtensionOperationError.
 */
class DeferredTerminalTransport implements OpenTrayTransport {
  constructor(private readonly payload: ExtOperationPayload) {}

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    if (frame.type !== "ext-command") {
      throw new Error(`unexpected frame type: ${frame.type}`);
    }
    if (this.payload.kind === "error") {
      throw new ExtensionOperationError(
        this.payload.error.code,
        this.payload.error.message,
        { details: this.payload.error.details }
      );
    }
    return {
      type: "ext-operation-terminal",
      operationId: "0000000000000001",
      payload: this.payload,
    };
  }
}

/** Immediate legacy extension command answering with response envelopes. */
class ImmediateEventsTransport implements OpenTrayTransport {
  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    if (frame.type !== "ext-command") {
      throw new Error(`unexpected frame type: ${frame.type}`);
    }
    return {
      type: "ext-command-result",
      requestId: frame.requestId,
      events: [
        {
          scope: { appId: frame.appId, trayId: frame.trayId, ext: frame.ext },
          data: { type: "views", count: 1 },
        },
      ],
    };
  }
}

/** Correlated synchronous server error frames, first with details then without. */
class SyncErrorTransport implements OpenTrayTransport {
  private replies = 0;

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    if (frame.type !== "ext-command") {
      throw new Error(`unexpected frame type: ${frame.type}`);
    }
    this.replies += 1;
    return this.replies === 1
      ? {
          type: "error",
          requestId: frame.requestId,
          code: "dialog_presentation_failed",
          message: "worker did not reach the native modal call",
          details: { worker: "owner-1", phase: "enter-modal" },
        }
      : {
          type: "error",
          requestId: frame.requestId,
          code: "dialog_worker_limit_reached",
          message: "worker cap reached",
        };
  }
}

const createTestRequestId = (): string => "req-test";

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFileAt(path, `${JSON.stringify(value)}\n`);
};

const writeFileAt = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
};
