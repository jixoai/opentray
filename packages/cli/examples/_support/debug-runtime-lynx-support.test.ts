import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLynxShowCommand,
  describeLynxHostFeatures,
  prepareLocalLynxExtensionPath,
  resolveBundledReviewBundlePath,
  resolveLynxBundlePath,
  resolveLynxHostFeatures,
} from "./debug-runtime-lynx-support";

describe("debug runtime lynx smoke helpers", () => {
  afterEach(() => {
    delete process.env.INIT_CWD;
    delete process.env.OPENTRAY_EXT_PATH;
    delete process.env.OPENTRAY_LYNX_BUNDLE;
    delete process.env.OPENTRAY_LYNX_HOST_FEATURES;
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

  it("resolves the source-tree Lynx extension path when the platform artifact and carrier are staged", () => {
    const dir = mkdtempSync(join(tmpdir(), "opentray-lynx-extension-"));
    try {
      const modulePath = join(
        dir,
        "packages/cli/examples/_support/debug-runtime-lynx-support.ts"
      );
      const packageRoot = join(dir, "packages/ext-lynx-darwin-arm64");
      const dylib = join(packageRoot, "lib/libopentray_ext_lynx.dylib");
      const runtimeZip = join(
        packageRoot,
        "runtime/OpenTrayLynxRuntime.app.zip"
      );
      mkdirSync(join(dir, "crates/opentray-bin"), { recursive: true });
      mkdirSync(join(modulePath, ".."), { recursive: true });
      mkdirSync(join(packageRoot, "lib"), { recursive: true });
      mkdirSync(join(packageRoot, "runtime"), { recursive: true });
      writeFileSync(join(dir, "Cargo.toml"), "");
      writeFileSync(join(dir, "crates/opentray-bin/Cargo.toml"), "");
      writeFileSync(dylib, "");
      writeFileSync(runtimeZip, "");

      expect(
        prepareLocalLynxExtensionPath(pathToFileURL(modulePath).href, {
          platform: "darwin",
          arch: "arm64",
        })
      ).toBe(dylib);
      expect(process.env.OPENTRAY_EXT_PATH).toBe(dylib);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves baseline host features from an empty expression", () => {
    expect(resolveLynxHostFeatures()).toEqual({
      nativeWindowApi: false,
      bindWindowGlobals: false,
      nativeScreenApi: false,
      bindScreenGlobals: false,
      frameless: false,
    });
    expect(describeLynxHostFeatures(resolveLynxHostFeatures())).toBe(
      "baseline"
    );
  });

  it("supports wildcard and explicit disable tokens for host features", () => {
    const features = resolveLynxHostFeatures("*,!nativeScreenApi");

    expect(features).toEqual({
      nativeWindowApi: true,
      bindWindowGlobals: true,
      nativeScreenApi: false,
      bindScreenGlobals: false,
      frameless: true,
    });
    expect(describeLynxHostFeatures(features)).toBe(
      "nativeWindowApi,bindWindowGlobals,frameless"
    );
  });

  it("normalizes binding features to their parent host apis", () => {
    expect(
      resolveLynxHostFeatures("bindWindowGlobals,bindScreenGlobals")
    ).toEqual({
      nativeWindowApi: true,
      bindWindowGlobals: true,
      nativeScreenApi: true,
      bindScreenGlobals: true,
      frameless: false,
    });
  });

  it("creates a fixed-size smoke command from explicit host features", () => {
    const command = createLynxShowCommand({
      bundlePath: "/tmp/demo.lynx.bundle",
      hostFeatures: resolveLynxHostFeatures(
        "nativeWindowApi,bindWindowGlobals,frameless"
      ),
    });

    expect(command.width).toBe(720);
    expect(command.height).toBe(420);
    expect(command.nativeWindowApi).toBe(true);
    expect(command.bindWindowGlobals).toBe(true);
    expect(command.nativeScreenApi).toBe(false);
    expect(command.bindScreenGlobals).toBe(false);
    expect(command.style).toEqual({ frameless: true });
    expect(command.title).toBe(
      "OpenTray Lynx Smoke (nativeWindowApi,bindWindowGlobals,frameless)"
    );
  });
});
