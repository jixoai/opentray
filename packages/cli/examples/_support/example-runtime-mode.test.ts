import { describe, expect, it } from "vitest";

import {
  resolveExampleRuntimeMode,
  stripExampleRuntimeModeArgs,
} from "./example-runtime-mode";

describe("Feature: example runtime mode", () => {
  it("Scenario: Given no runtime flag When mode is resolved Then debug remains the default", () => {
    expect(resolveExampleRuntimeMode([], {})).toBe("debug");
  });

  it("Scenario: Given release shorthand When mode is resolved Then release binaries are selected", () => {
    expect(resolveExampleRuntimeMode(["-r"], {})).toBe("release");
    expect(resolveExampleRuntimeMode(["--release"], {})).toBe("release");
  });

  it("Scenario: Given runtime flags and script flags When args are stripped Then only script flags remain", () => {
    expect(
      stripExampleRuntimeModeArgs(["-r", "--overlay", "--release", "--debug"]),
    ).toEqual(["--overlay"]);
  });
});
