import { describe, expect, test } from "bun:test";

import { resolveVerifyNativePlan } from "./verify-native-plan";

describe("Feature: native verification planner", () => {
  test("Scenario: Given all native atoms are verified When the plan is resolved Then each extension compiles in its own job", () => {
    const plan = resolveVerifyNativePlan();

    expect(plan.jobs.every((job) => job.components.length === 1)).toBe(true);
    expect(
      plan.jobs.some(
        (job) =>
          job.components.includes("webview") && job.components.includes("lynx")
      )
    ).toBe(false);
    expect(plan.jobs.map((job) => job.artifactName)).toContain(
      "native-darwin-arm64-lynx-runtime"
    );
    expect(new Set(plan.jobs.map((job) => job.artifactName)).size).toBe(
      plan.jobs.length
    );
    expect(
      plan.stageEntries.every((entry) => entry.artifactName.startsWith("native-"))
    ).toBe(true);
  });
});
