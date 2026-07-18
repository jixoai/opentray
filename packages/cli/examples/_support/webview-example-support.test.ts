// Orthogonal intents (maintained 2026-07-19; original user request: `example:webview-control` cannot start):
// 1. Verify example window defaults remain explicit.
// 2. Verify source examples receive a caller-scoped broker identity.
// 3. Verify runtime shutdown releases WebView connections before Vite closes.
// 4. Keep source-example Unix endpoints within the native socket path limit.

import { describe, expect, it } from "vitest";

import { resolveDaemonPaths } from "../../src/daemon/paths";

import {
  createExamplePrimaryMenu,
  createExampleCallerLabel,
  createShortExampleHome,
  hasConfiguredBrokerBinaryPath,
  hasConfiguredWebviewExtensionPath,
  requireWindowsExample,
  shutdownWebviewExample,
  withExampleWebviewWindowDefaults,
} from "./webview-example-support";

describe("Feature: WebView example support", () => {
  it("Scenario: Given a Windows-only composition regression example When another platform invokes it Then it fails truthfully", () => {
    expect(() => requireWindowsExample("example:win32-bug", "darwin")).toThrow(
      "example:win32-bug is a Windows-only composition regression example",
    );
    expect(() => requireWindowsExample("example:win32-bug", "win32")).not.toThrow();
  });

  it("Scenario: Given a retained example window When operational visibility changes Then the primary menu states the next action", () => {
    expect(createExamplePrimaryMenu({ visible: false }).items).toEqual([
      { type: "item", id: 1, title: "Show Example", primaryEvent: true },
    ]);
    expect(
      createExamplePrimaryMenu({
        visible: true,
        trailingItems: [{ type: "separator" }, { type: "item", id: 99, title: "Quit Demo" }],
      }).items,
    ).toEqual([
      { type: "item", id: 1, title: "Hide Example", primaryEvent: true },
      { type: "separator" },
      { type: "item", id: 99, title: "Quit Demo" },
    ]);
  });

  it("Scenario: Given any WebView example window When defaults are applied Then devtools are always enabled", () => {
    expect(
      withExampleWebviewWindowDefaults({
        html: "<main />",
        devtools: false,
      }).devtools,
    ).toBe(true);
  });

  it("Scenario: Given a source WebView example When its broker identity is derived Then it cannot attach to the neutral default endpoint", () => {
    const callerLabel = createExampleCallerLabel("opentray-webview-control", 12_345);

    expect(callerLabel).toMatch(/^example-12345-[a-f0-9]{8}$/u);
    expect(callerLabel).toBe(createExampleCallerLabel("opentray-webview-control", 12_345));
    expect(callerLabel).not.toBe("opentray");
  });

  it("Scenario: Given a source WebView example on macOS When its endpoint is derived Then it fits the native Unix socket path", () => {
    const homePrefix = "opentray-debug-runtime-tray";
    const endpoint = resolveDaemonPaths({
      homeDir: createShortExampleHome(homePrefix),
      packageVersion: "0.14.4",
      callerLabel: createExampleCallerLabel(homePrefix),
      platform: "darwin",
    }).endpoint;

    expect(Buffer.byteLength(endpoint, "utf8")).toBeLessThan(104);
  });

  it("Scenario: Given an explicit extension loader path When a source example prepares its runtime Then the explicit path remains authoritative", () => {
    expect(
      hasConfiguredWebviewExtensionPath({
        OPENTRAY_EXT_PATH: "E:\\artifacts\\opentray_ext_webview.dll",
      }),
    ).toBe(true);
    expect(hasConfiguredWebviewExtensionPath({ OPENTRAY_EXT_PATH: "   " })).toBe(false);
  });

  it("Scenario: Given an explicit extension DLL When no broker override is supplied Then the source broker remains selectable", () => {
    expect(hasConfiguredBrokerBinaryPath({})).toBe(false);
    expect(hasConfiguredBrokerBinaryPath({ OPENTRAY_BROKER_BIN: "   " })).toBe(false);
    expect(
      hasConfiguredBrokerBinaryPath({
        OPENTRAY_BROKER_BIN: "E:\\artifacts\\opentray.exe",
      }),
    ).toBe(true);
  });

  it("Scenario: Given a source WebView example When shutdown begins Then its runtime closes before Vite", async () => {
    const calls: string[] = [];

    await shutdownWebviewExample(
      {
        async shutdown() {
          calls.push("runtime");
        },
      },
      {
        async close() {
          calls.push("vite");
        },
      },
    );

    expect(calls).toEqual(["runtime", "vite"]);
  });

  it("Scenario: Given runtime cleanup fails When shutdown begins Then Vite still closes", async () => {
    const calls: string[] = [];

    await expect(
      shutdownWebviewExample(
        {
          async shutdown() {
            calls.push("runtime");
            throw new Error("runtime close failed");
          },
        },
        {
          async close() {
            calls.push("vite");
          },
        },
      ),
    ).rejects.toThrow("runtime close failed");

    expect(calls).toEqual(["runtime", "vite"]);
  });
});
