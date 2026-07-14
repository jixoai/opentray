// Orthogonal intents (2026-07-14; original user request: `example:webview-control` cannot start):
// 1. Verify example window defaults remain explicit.
// 2. Verify source examples receive a caller-scoped broker identity.

import { describe, expect, it } from "vitest";

import {
  createExampleCallerLabel,
  hasConfiguredWebviewExtensionPath,
  withExampleWebviewWindowDefaults,
} from "./webview-example-support";

describe("Feature: WebView example support", () => {
  it("Scenario: Given any WebView example window When defaults are applied Then devtools are always enabled", () => {
    expect(
      withExampleWebviewWindowDefaults({
        html: "<main />",
        devtools: false,
      }).devtools,
    ).toBe(true);
  });

  it("Scenario: Given a source WebView example When its broker identity is derived Then it cannot attach to the neutral default endpoint", () => {
    expect(createExampleCallerLabel("opentray-webview-control", 12_345)).toBe(
      "example-12345-opentray-webview-control",
    );
  });

  it("Scenario: Given an explicit extension loader path When a source example prepares its runtime Then the explicit path remains authoritative", () => {
    expect(
      hasConfiguredWebviewExtensionPath({
        OPENTRAY_EXT_PATH: "E:\\artifacts\\opentray_ext_webview.dll",
      }),
    ).toBe(true);
    expect(hasConfiguredWebviewExtensionPath({ OPENTRAY_EXT_PATH: "   " })).toBe(
      false,
    );
  });
});
