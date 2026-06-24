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
});
