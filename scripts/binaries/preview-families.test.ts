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
      ]),
    ).toEqual(["ext-webview-native"]);
  });

  test("Scenario: Given explicit WebView preview job When the job is materialized Then Lynx is excluded from the build closure", () => {
    const [job] = materializePreviewBuildJobs("webview-20260605-1", ["ext-webview-native"], ["darwin-arm64"]);

    expect(job.family).toBe("ext-webview-native");
    expect(job.target).toBe("darwin-arm64");
    expect(job.runner).toBe("macos-15");
    expect(job.buildLynxRuntime).toBe(false);
  });

  test("Scenario: Given Lynx runtime family When the job is materialized Then the runtime timeout metadata is preserved", () => {
    const [job] = materializePreviewBuildJobs("lynx-20260605-1", ["ext-lynx-runtime"], ["darwin-x64"]);

    expect(job.family).toBe("ext-lynx-runtime");
    expect(job.buildLynxRuntime).toBe(true);
    expect(job.lynxRuntimeTimeoutSeconds).toBe(5_700);
    expect(job.jobTimeoutMinutes).toBe(120);
  });

  test("Scenario: Given unsupported target for Lynx runtime When preview targets are resolved Then the error is explicit", () => {
    expect(() => resolvePreviewTargetsForFamilies(["ext-lynx-runtime"], ["linux-x64"])).toThrow(
      "preview build family ext-lynx-runtime does not support target linux-x64",
    );
  });
});
