import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BrokerServerError,
  createTrayHandle,
  ExtensionOperationError,
  type NativeExtensionExpectedIdentity,
  type OpenTrayTransport,
} from "opentray";
import type { ClientRequestFrame, RequestId, ServerFrame } from "@opentray/spec";

import {
  attachDialog,
  DialogError,
  DialogExt,
  DIALOG_ERROR_CODES,
  DIALOG_NATIVE_ARTIFACT,
  type DialogBackendCapabilities,
  type DialogCapability,
  type MessageDialogOptions,
  type MessageSugarOptions,
} from "./index";
import { expandHomeDirectory } from "./shared";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "dialog",
  artifactSetVersion: "test",
  contractFingerprint: "dialog-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;

const MOUNT_ID = "dialog.tray-1";
const TERMINAL_OPERATION_ID = "0123456789abcdef";

const DARWIN_BACKEND: DialogBackendCapabilities = {
  platform: "darwin",
  taskDialog: false,
  commandLinks: false,
  expander: false,
  suppression: true,
  packageSemantics: true,
  mixedFileDirectorySelection: true,
  addToRecentControl: false,
};

const WIN32_BACKEND: DialogBackendCapabilities = {
  platform: "win32",
  taskDialog: true,
  commandLinks: true,
  expander: true,
  suppression: true,
  packageSemantics: false,
  mixedFileDirectorySelection: false,
  addToRecentControl: true,
};

const WIN32_MESSAGEBOX_BACKEND: DialogBackendCapabilities = {
  ...WIN32_BACKEND,
  taskDialog: false,
  commandLinks: false,
  expander: false,
};

const WIN32_NO_EXPANDER_BACKEND: DialogBackendCapabilities = {
  ...WIN32_BACKEND,
  expander: false,
};

type ExtCommandFrame = Extract<ClientRequestFrame, { type: "ext-command" }>;
type ExtCommandHandler = (frame: ExtCommandFrame) => ServerFrame | Promise<ServerFrame>;

/** Resolves ext-command requests through scripted handlers; everything else acks. */
class ScriptedTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];
  private readonly extCommandHandlers: ExtCommandHandler[];

  constructor(handlers: readonly ExtCommandHandler[] = []) {
    this.extCommandHandlers = [...handlers];
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (frame.type === "ext-command") {
      const handler = this.extCommandHandlers.shift();
      if (handler === undefined) {
        throw new Error(`unexpected ext-command ${JSON.stringify(frame.data)}`);
      }
      return handler(frame);
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

const attachTestDialog = (
  platform: "darwin" | "win32" | "linux",
  transport: ScriptedTransport
): DialogCapability =>
  attachDialog(createTrayHandle(transport, "app-1", "tray-1"), {
    mountId: MOUNT_ID,
    artifact: TEST_NATIVE_ARTIFACT,
    platform,
  });

/** Exactly what the local broker transport resolves a deferred request with. */
const terminalResult = (value: unknown): ServerFrame => ({
  type: "ext-operation-terminal",
  operationId: TERMINAL_OPERATION_ID,
  payload: { kind: "result", value },
});

const backendEventResult = (
  backend: DialogBackendCapabilities,
  requestId: RequestId
): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [
    {
      scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
      data: { type: "backend", backend },
    },
  ],
});

const makeTempDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "opentray-dialog-"));

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("@opentray/ext-dialog", () => {
  it("declares the embedded artifact over the frozen four-target staging matrix", () => {
    expect(DIALOG_NATIVE_ARTIFACT.kind).toBe("embedded");
    expect(DIALOG_NATIVE_ARTIFACT.targets).toEqual({
      "darwin-arm64": {
        libraryPath: "platforms/darwin-arm64/libopentray_ext_dialog.dylib",
      },
      "darwin-x64": {
        libraryPath: "platforms/darwin-x64/libopentray_ext_dialog.dylib",
      },
      "win32-arm64": {
        libraryPath: "platforms/win32-arm64/opentray_ext_dialog.dll",
      },
      "win32-x64": {
        libraryPath: "platforms/win32-x64/opentray_ext_dialog.dll",
      },
    });
    expect(DIALOG_NATIVE_ARTIFACT.packageJsonUrl).toContain("ext-dialog/package.json");
    expect(DIALOG_NATIVE_ARTIFACT.contractManifestUrl).toContain("ext-dialog/contract.json");
    expect(DialogExt.name).toBe("dialog");
    expect(DialogExt.artifact).toBe(DIALOG_NATIVE_ARTIFACT);
  });

  it("emits load-ext with expectedIdentity, then camelCase ext-commands for sugar dialogs", async () => {
    const transport = new ScriptedTransport([
      () => terminalResult({ response: 0, suppressed: false }),
      () => terminalResult({ response: 0, suppressed: false }),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    await dialog.alert("Saved");
    const confirmed = await dialog.confirm("Proceed?", { severity: "warning" });

    expect(confirmed).toBe(true);
    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "dialog",
        path: TEST_NATIVE_ARTIFACT.path,
        expectedIdentity: TEST_EXPECTED_IDENTITY,
        mountId: MOUNT_ID,
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: {
          type: "messageDialog",
          options: { message: "Saved", buttons: ["OK"], defaultId: 0 },
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: {
          type: "messageDialog",
          options: {
            message: "Proceed?",
            buttons: ["OK", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            severity: "warning",
          },
        },
      },
    ]);
  });

  it("confirm resolves false for the cancel button and messageDialog reports suppression", async () => {
    const transport = new ScriptedTransport([
      () => terminalResult({ response: 1, suppressed: false }),
      () => terminalResult({ response: 2, suppressed: true }),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    await expect(dialog.confirm("Proceed?")).resolves.toBe(false);
    await expect(
      dialog.messageDialog({
        message: "Allow access?",
        buttons: ["Always", "Once", "Never"],
        defaultId: 1,
        cancelId: 2,
        suppressionLabel: "Remember my choice",
      })
    ).resolves.toEqual({ response: 2, suppressed: true });
    expect(transport.frames[2]).toMatchObject({
      data: {
        type: "messageDialog",
        options: {
          message: "Allow access?",
          buttons: ["Always", "Once", "Never"],
          defaultId: 1,
          cancelId: 2,
          suppressionLabel: "Remember my choice",
        },
      },
    });
  });

  it("rejects typed when a deferred terminal carries an error payload", async () => {
    const wireError = new ExtensionOperationError(
      "dialog_session_busy",
      "owner already shows a dialog",
      { details: { kind: "busy", owner: "tray-1" } }
    );
    const transport = new ScriptedTransport([
      () => {
        throw wireError;
      },
    ]);
    const dialog = attachTestDialog("darwin", transport);

    const rejection = dialog.messageDialog({ message: "Second" });
    await expect(rejection).rejects.toBeInstanceOf(DialogError);
    const error = (await rejection.catch((caught: unknown) => caught)) as DialogError;
    expect(error.code).toBe(DIALOG_ERROR_CODES.sessionBusy);
    expect(error.details).toEqual({ kind: "busy", owner: "tray-1" });
    expect(error.cause).toBe(wireError);
  });

  it("maps the shared transport-close code onto dialog_transport_closed", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError(
          "extension_transport_closed",
          "the broker transport closed while a deferred extension operation was pending"
        );
      },
    ]);
    const dialog = attachTestDialog("darwin", transport);

    const rejection = dialog.pickFile();
    await expect(rejection).rejects.toBeInstanceOf(DialogError);
    const error = (await rejection.catch((caught: unknown) => caught)) as DialogError;
    expect(error.code).toBe(DIALOG_ERROR_CODES.transportClosed);
    expect(error.details).toEqual({ kind: "transport" });
    expect(error.cause).toBeInstanceOf(ExtensionOperationError);
  });

  it("normalizes synchronous broker error frames with dialog codes", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new BrokerServerError(
          "dialog_presentation_failed",
          "worker did not enter the native modal call within 3s",
          { details: { kind: "presentation" } }
        );
      },
    ]);
    const dialog = attachTestDialog("win32", transport);

    const rejection = dialog.pickDirectory();
    await expect(rejection).rejects.toBeInstanceOf(DialogError);
    const error = (await rejection.catch((caught: unknown) => caught)) as DialogError;
    expect(error.code).toBe(DIALOG_ERROR_CODES.presentationFailed);
    expect(error.details).toEqual({ kind: "presentation" });
    expect(error.cause).toBeInstanceOf(BrokerServerError);
  });

  it("getBackend lazily requests the DTO once and returns one immutable snapshot", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(DARWIN_BACKEND, frame.requestId),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    const first = await dialog.getBackend();
    const second = await dialog.getBackend();

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual(DARWIN_BACKEND);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getBackend" },
    });
  });

  it("getBackend consumes the exact ABI-shaped event the native crate emits", async () => {
    // Same-family fix as the sound review R1 P1: the native crate's
    // immediate getBackend event is `data: { type: "backend", backend }`
    // (ext-dialog lib.rs); this fixture round-trips that exact JSON so a
    // future native/facade shape drift fails here instead of in production.
    type BackendEvent = Extract<ServerFrame, { type: "ext-command-result" }>["events"][number];
    const nativeJson = JSON.stringify({
      scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
      data: { type: "backend", backend: DARWIN_BACKEND },
    });
    const abiTransport = new ScriptedTransport([
      (frame) =>
        ({
          type: "ext-command-result",
          requestId: frame.requestId,
          events: [JSON.parse(nativeJson) as BackendEvent],
        }) as ReturnType<typeof backendEventResult>,
    ]);
    const dialog = attachTestDialog("darwin", abiTransport);
    await expect(dialog.getBackend()).resolves.toEqual(DARWIN_BACKEND);
  });

  it("getBackend also accepts a deferred terminal backend snapshot", async () => {
    const transport = new ScriptedTransport([() => terminalResult(WIN32_BACKEND)]);
    const dialog = attachTestDialog("win32", transport);

    await expect(dialog.getBackend()).resolves.toEqual(WIN32_BACKEND);
  });

  it("rejects empty buttons and out-of-range indices before any state change", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("darwin", transport);

    await expect(dialog.messageDialog({ message: "m", buttons: [] })).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "buttons" },
    });
    await expect(
      dialog.messageDialog({ message: "m", buttons: ["OK"], defaultId: 5 })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "defaultId" },
    });
    await expect(
      dialog.messageDialog({ message: "m", buttons: ["OK"], cancelId: -1 })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "cancelId" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects a non-current platform namespace with structured details", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("darwin", transport);
    const win32Dialog = attachTestDialog("win32", new ScriptedTransport());

    await expect(dialog.alert("m", { win32: { footer: "f" } })).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.platformNamespaceMismatch,
      details: { kind: "namespace", namespace: "win32", platform: "darwin" },
    });
    await expect(
      win32Dialog.pickFile({ darwin: { canSelectPackages: true } })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.platformNamespaceMismatch,
      details: { kind: "namespace", namespace: "darwin", platform: "win32" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects unknown fields anywhere (beep lives in @opentray/ext-sound, not here)", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("darwin", transport);
    const win32Dialog = attachTestDialog("win32", new ScriptedTransport());

    const sneakyTopLevel = { message: "m", beep: true } as MessageDialogOptions;
    await expect(dialog.messageDialog(sneakyTopLevel)).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "beep" },
    });
    const sneakyNamespace = {
      message: "m",
      win32: { mystery: 1 },
    } as MessageDialogOptions;
    await expect(win32Dialog.messageDialog(sneakyNamespace)).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "win32.mystery" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects buttonHints outside commandLink style and misaligned hint arrays", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("win32", transport);

    await expect(
      dialog.messageDialog({
        message: "m",
        buttons: ["A", "B"],
        win32: { buttonHints: ["a", "b"] },
      })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "win32.buttonHints" },
    });
    await expect(
      dialog.messageDialog({
        message: "m",
        buttons: ["A", "B"],
        win32: { buttonStyle: "commandLink", buttonHints: ["only one"] },
      })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "win32.buttonHints" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("gates commandLink on the backend snapshot before dispatch (MessageBox fallback)", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_MESSAGEBOX_BACKEND, frame.requestId),
    ]);
    const dialog = attachTestDialog("win32", transport);

    await expect(
      dialog.messageDialog({
        message: "m",
        buttons: ["A", "B"],
        win32: { buttonStyle: "commandLink", buttonHints: ["a", "b"] },
      })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.capabilityUnavailable,
      details: { kind: "capability", capability: "taskDialog", platform: "win32" },
    });
    // Rejection happened before any dialog dispatch: only load-ext + getBackend.
    expect(transport.frames).toHaveLength(2);
  });

  it("gates the expander namespace switch on its own DTO flag", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_NO_EXPANDER_BACKEND, frame.requestId),
    ]);
    const dialog = attachTestDialog("win32", transport);

    await expect(
      dialog.messageDialog({
        message: "m",
        win32: { expander: { expandedInformation: "details" } },
      })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.capabilityUnavailable,
      details: { kind: "capability", capability: "expander", platform: "win32" },
    });
    expect(transport.frames).toHaveLength(2);
  });

  it("rejects malformed filters and an orphan defaultFilterIndex", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("darwin", transport);

    await expect(
      dialog.pickFile({ filters: [{ name: "Bad", extensions: [".png"] }] })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "filters[0].extensions" },
    });
    await expect(dialog.pickSavePath({ defaultFilterIndex: 0 })).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "defaultFilterIndex" },
    });
    // Preflight rejections never reach the transport.
    expect(transport.frames).toHaveLength(0);
  });

  it("treats an explicitly empty filter array as all files and omits it on the wire", async () => {
    // Design §1.2: 空/缺省 filters = 全部文件 — an empty array is the
    // caller's "all files" spelling; the facade must not forward it
    // (darwin allowedContentTypes([]) would mean "nothing selectable").
    const transport = new ScriptedTransport([
      () => terminalResult(null),
      () => terminalResult("/tmp/out"),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    await expect(dialog.pickFile({ filters: [] })).resolves.toBeNull();
    await expect(dialog.pickSavePath({ filters: [], fileNameLabel: "out" })).resolves.toBe(
      "/private/tmp/out"
    );
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "pickFile", options: {} },
    });
    expect(transport.frames[2]).toMatchObject({
      type: "ext-command",
      data: { type: "pickSavePath", options: { fileNameLabel: "out" } },
    });

    // Combination boundary (batch C review P2): an orphan
    // defaultFilterIndex against the empty-array all-files spelling is
    // still a preflight rejection — there is no filter to index into.
    await expect(
      dialog.pickSavePath({ filters: [], defaultFilterIndex: 0 })
    ).rejects.toMatchObject({
      code: DIALOG_ERROR_CODES.invalidOptions,
      details: { kind: "options", field: "defaultFilterIndex" },
    });
  });

  it("rejects every method on linux with a typed platform error before load", async () => {
    const transport = new ScriptedTransport();
    const dialog = attachTestDialog("linux", transport);

    const rejections: readonly Promise<unknown>[] = [
      dialog.alert("m"),
      dialog.confirm("m"),
      dialog.messageDialog({ message: "m" }),
      dialog.pickFile(),
      dialog.pickDirectory(),
      dialog.pickSavePath(),
      dialog.getBackend(),
    ];
    for (const rejection of rejections) {
      await expect(rejection).rejects.toMatchObject({
        code: DIALOG_ERROR_CODES.platformUnsupported,
        details: { kind: "platform", platform: "linux" },
      });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("pickFile returns canonical absolute paths, null on cancel, and exact overload types", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "picked.txt");
    const otherPath = join(dir, "sibling.bin");
    await writeFile(filePath, "payload");
    await writeFile(otherPath, "sibling");
    const canonicalFile = await realpath(filePath);
    const canonicalOther = await realpath(otherPath);

    const transport = new ScriptedTransport([
      () => terminalResult(filePath),
      () => terminalResult(null),
      () => terminalResult([filePath, otherPath]),
      () => terminalResult([filePath]),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    const single = await dialog.pickFile();
    expectTypeOf(single).toEqualTypeOf<string | null>();
    expect(single).toBe(canonicalFile);

    await expect(dialog.pickFile()).resolves.toBeNull();

    const multiple = await dialog.pickFile({ multiple: true });
    expectTypeOf(multiple).toEqualTypeOf<readonly string[] | null>();
    expect(multiple).toEqual([canonicalFile, canonicalOther]);
    expect(transport.frames[3]).toMatchObject({
      type: "ext-command",
      data: { type: "pickFile", options: { multiple: true } },
    });

    // @ts-expect-error — a multiple pick result is readonly string[] | null, never string
    const asString: string = await dialog.pickFile({ multiple: true });
    expect(asString).toEqual([canonicalFile]);
  });

  it("pickSavePath canonicalizes a not-yet-existing leaf against its existing parent", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const saveLeaf = join(dir, "brand-new-notes.txt");

    const transport = new ScriptedTransport([() => terminalResult(saveLeaf)]);
    const dialog = attachTestDialog("darwin", transport);

    const saved = await dialog.pickSavePath({
      filters: [{ name: "Text", extensions: ["txt"] }],
      fileNameLabel: "Save as",
      defaultFilterIndex: 0,
    });

    expect(saved).toBe(join(await realpath(dir), "brand-new-notes.txt"));
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: {
        type: "pickSavePath",
        options: {
          filters: [{ name: "Text", extensions: ["txt"] }],
          fileNameLabel: "Save as",
          defaultFilterIndex: 0,
        },
      },
    });
  });

  it("pickDirectory emits normalized command options", async () => {
    const transport = new ScriptedTransport([() => terminalResult(null)]);
    const dialog = attachTestDialog("win32", transport);

    await expect(
      dialog.pickDirectory({ title: "Choose", win32: { addToRecent: false } })
    ).resolves.toBeNull();

    expect(transport.frames[1]).toEqual({
      type: "ext-command",
      requestId: "opentray-2",
      appId: "app-1",
      trayId: "tray-1",
      ext: MOUNT_ID,
      data: {
        type: "pickDirectory",
        options: { title: "Choose", win32: { addToRecent: false } },
      },
    });
  });

  it("freezes the sugar option surface at the type level and at runtime", async () => {
    const transport = new ScriptedTransport([
      () => terminalResult({ response: 0, suppressed: false }),
    ]);
    const dialog = attachTestDialog("darwin", transport);

    expectTypeOf(dialog.alert).parameter(1).toEqualTypeOf<MessageSugarOptions | undefined>();
    // @ts-expect-error — sugar options cannot override message/buttons/defaultId/cancelId (design reference section 1)
    await dialog.alert("typed only", { buttons: ["Retry"] });

    // The runtime sugar applies its own fixed button set; the caller's buttons never reach the wire.
    expect(transport.frames[1]).toMatchObject({
      data: {
        type: "messageDialog",
        options: { message: "typed only", buttons: ["OK"], defaultId: 0 },
      },
    });
  });
});

describe("shared pure helpers", () => {
  it("expands a leading tilde against the supplied home directory", () => {
    expect(expandHomeDirectory("~", "/home/u")).toBe("/home/u");
    expect(expandHomeDirectory("~/notes/a.txt", "/home/u")).toBe(
      join("/home/u", "notes/a.txt")
    );
    expect(expandHomeDirectory("/tmp/x", "/home/u")).toBe("/tmp/x");
    expect(expandHomeDirectory("~other/x", "/home/u")).toBe("~other/x");
  });
});
