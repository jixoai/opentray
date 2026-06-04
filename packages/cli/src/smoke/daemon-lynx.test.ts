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
  createLynxShowCommand,
  resolveBundledReviewBundlePath,
  resolveLynxBundlePath,
  resolveLynxHostProfile,
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

  it("normalizes the smoke host profile to baseline or full", () => {
    expect(resolveLynxHostProfile({ OPENTRAY_LYNX_HOST_PROFILE: "baseline" })).toBe(
      "baseline"
    );
    expect(resolveLynxHostProfile({ OPENTRAY_LYNX_HOST_PROFILE: " BASELINE " })).toBe(
      "baseline"
    );
    expect(resolveLynxHostProfile({ OPENTRAY_LYNX_HOST_PROFILE: "full" })).toBe(
      "full"
    );
    expect(resolveLynxHostProfile({ OPENTRAY_LYNX_HOST_PROFILE: "unknown" })).toBe(
      "full"
    );
  });

  it("creates a baseline smoke command that disables host-owned layering", () => {
    const command = createLynxShowCommand({
      bundlePath: "/tmp/demo.lynx.bundle",
      hostProfile: "baseline",
      mode: "fit",
    });

    expect(command.fitContentSize).toBe(false);
    expect(command.nativeWindowApi).toBe(false);
    expect(command.bindWindowGlobals).toBe(false);
    expect(command.nativeScreenApi).toBe(false);
    expect(command.bindScreenGlobals).toBe(false);
    expect(command.width).toBe(720);
    expect(command.height).toBe(420);
    expect(command.title).toBe("OpenTray Lynx Baseline Smoke");
  });

  it("creates a full smoke command that keeps fit and fixed variants distinct", () => {
    const fit = createLynxShowCommand({
      bundlePath: "/tmp/demo.lynx.bundle",
      hostProfile: "full",
      mode: "fit",
    });
    const fixed = createLynxShowCommand({
      bundlePath: "/tmp/demo.lynx.bundle",
      hostProfile: "full",
      mode: "fixed",
    });

    expect(fit.fitContentSize).toBe(true);
    expect(fit.width).toBeUndefined();
    expect(fit.height).toBeUndefined();
    expect(fit.nativeWindowApi).toBe(true);
    expect(fit.title).toBe("OpenTray Lynx Fit Smoke");
    expect(fixed.fitContentSize).toBe(false);
    expect(fixed.width).toBe(720);
    expect(fixed.height).toBe(420);
    expect(fixed.title).toBe("OpenTray Lynx Fixed Smoke");
  });
});
