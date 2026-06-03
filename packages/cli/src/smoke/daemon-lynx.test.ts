import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveBundledReviewBundlePath,
  resolveLynxBundlePath,
} from "./daemon-lynx";

describe("daemon lynx smoke helpers", () => {
  afterEach(() => {
    delete process.env.INIT_CWD;
    delete process.env.OPENTRAY_LYNX_BUNDLE;
  });

  it("resolves bundle paths relative to the original shell cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "opentray-lynx-bundle-"));
    try {
      const bundle = join(dir, "main.lynx.bundle");
      writeFileSync(bundle, "bundle-bytes");
      process.env.INIT_CWD = dir;

      expect(resolveLynxBundlePath("./main.lynx.bundle")).toBe(
        realpathSync(bundle)
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the packaged review bundle when no override is provided", () => {
    const reviewBundle = resolveBundledReviewBundlePath();

    expect(existsSync(reviewBundle)).toBe(true);
    expect(resolveLynxBundlePath()).toBe(realpathSync(reviewBundle));
  });
});
