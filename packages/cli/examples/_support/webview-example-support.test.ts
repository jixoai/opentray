import { describe, expect, it } from "vitest";

import { withExampleWebviewWindowDefaults } from "./webview-example-support";

describe("Feature: WebView example support", () => {
  it("Scenario: Given any WebView example window When defaults are applied Then devtools are always enabled", () => {
    expect(
      withExampleWebviewWindowDefaults({
        html: "<main />",
        devtools: false,
      }).devtools,
    ).toBe(true);
  });
});
