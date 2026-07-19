import { describe, expect, test } from "bun:test";

import {
  inferPreviewFamiliesFromReleasePackages,
  materializePreviewBuildJobs,
  resolvePreviewTargetsForFamilies,
} from "./preview-families";

describe("Feature: preview build family graph", () => {
  test("Scenario: Given WebView release packages When preview families are inferred Then only ext-webview-native is selected", () => {
    expect(
      inferPreviewFamiliesFromReleasePackages([
        "opentray",
        "@opentray/ext-webview",
        "@opentray/ext-webview-darwin-arm64",
      ])
    ).toEqual(["ext-webview-native"]);
  });

  test("Scenario: Given core runtime release packages When preview families are inferred Then core-runtime is selected", () => {
    expect(
      inferPreviewFamiliesFromReleasePackages([
        "opentray",
        "@opentray/darwin-arm64",
      ])
    ).toEqual(["core-runtime"]);
  });

  test("Scenario: Given explicit WebView preview job When the job is materialized Then the target metadata stays explicit", () => {
    const [job] = materializePreviewBuildJobs(
      "webview-20260605-1",
      ["ext-webview-native"],
      ["darwin-arm64"]
    );

    expect(job.family).toBe("ext-webview-native");
    expect(job.target).toBe("darwin-arm64");
    expect(job.runner).toBe("macos-15");
  });

  test("Scenario: Given unsupported target for WebView native When preview targets are resolved Then Linux is rejected", () => {
    expect(() =>
      resolvePreviewTargetsForFamilies(["ext-webview-native"], ["linux-x64"])
    ).toThrow(
      "preview build family ext-webview-native does not support target linux-x64"
    );
  });
});
