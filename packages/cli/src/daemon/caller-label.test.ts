import { describe, expect, it } from "vitest";

import { resolveCallerLabel } from "./caller-label";

describe("caller label resolution", () => {
  it("prefers an explicit label over environment and script basename", () => {
    const label = resolveCallerLabel({
      explicit: "myapp",
      env: { npm_package_name: "other-tool" },
      argv: ["node", "/some/path/script.ts"],
    });

    expect(label).toBe("myapp");
  });

  it("falls back to npm_package_name when no explicit label is given", () => {
    const label = resolveCallerLabel({
      env: { npm_package_name: "my-tool" },
      argv: ["node", "/some/path/script.ts"],
    });

    expect(label).toBe("my-tool");
  });

  it("falls back to the script basename when no explicit or npm name is present", () => {
    const label = resolveCallerLabel({
      env: {},
      argv: ["node", "/projects/host/build.js"],
    });

    // basename "build.js" sanitizes to "build-js" (the dot becomes a separator).
    expect(label).toBe("build-js");
  });

  it("falls back to the neutral default when nothing is usable", () => {
    const label = resolveCallerLabel({ env: {}, argv: ["node"] });

    expect(label).toBe("opentray");
  });

  it("sanitizes unsafe characters in an explicit label", () => {
    const label = resolveCallerLabel({ explicit: "My App!!!" });

    expect(label).toBe("my-app");
  });

  it("keeps two distinct callers separate after sanitization", () => {
    const first = resolveCallerLabel({ explicit: "myapp" });
    const second = resolveCallerLabel({ explicit: "cli-tool" });

    expect(first).not.toBe(second);
  });

  it("derives the label from the appId slug ahead of tool fallbacks (D4)", () => {
    const label = resolveCallerLabel({
      appId: "com.baidu",
      env: { npm_package_name: "unrelated-tool" },
      argv: ["node", "/some/path/script.ts"],
    });

    // Dots collapse to separators: the appId slug is the endpoint identity.
    expect(label).toBe("com-baidu");
  });

  it("normalizes non-ASCII and punctuation appIds into a filesystem-safe slug (D4)", () => {
    const label = resolveCallerLabel({
      appId: "dev.百度.应用!!",
      env: {},
      argv: ["node"],
    });

    expect(label).toMatch(/^[a-z0-9-]+$/);
    expect(label).not.toContain("!");
  });

  it("keeps an explicit diagnostic label ahead of the appId slug (D4)", () => {
    const label = resolveCallerLabel({
      explicit: "isolation-probe",
      appId: "com.baidu",
      env: {},
      argv: ["node"],
    });

    expect(label).toBe("isolation-probe");
  });

  it("falls back to the tool chain unchanged when no appId is supplied (D4)", () => {
    const withNpm = resolveCallerLabel({
      env: { npm_package_name: "my-tool" },
      argv: ["node", "/some/path/script.ts"],
    });
    const withScript = resolveCallerLabel({
      env: {},
      argv: ["node", "/projects/host/build.js"],
    });
    const withNothing = resolveCallerLabel({ env: {}, argv: ["node"] });

    expect(withNpm).toBe("my-tool");
    expect(withScript).toBe("build-js");
    expect(withNothing).toBe("opentray");
  });
});
