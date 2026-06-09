import { describe, expect, test } from "bun:test";

import {
  classifyDistTagResult,
  classifyRegistryResult,
  createPackageManifest,
  defaultPackageDir,
  parseArgs,
  redact,
  trustMatches,
} from "./bootstrap-package";

describe("Feature: npm package bootstrap release law", () => {
  test("Scenario: Given an extension platform package When args are parsed Then defaults preserve the publish-before-trust flow", () => {
    const options = parseArgs([
      "--package",
      "@opentray/ext-webview-darwin-arm64",
      "--kind",
      "extension-platform",
      "--create-workspace",
      "--publish-if-missing",
      "--configure-trust",
    ]);

    expect(options.packageName).toBe("@opentray/ext-webview-darwin-arm64");
    expect(options.dir).toBe("packages/ext-webview-darwin-arm64");
    expect(options.kind).toBe("extension-platform");
    expect(options.dryRun).toBe(true);
    expect(options.publishAuth).toBe("token");
    expect(options.trustAuth).toBe("legacy-env");
    expect(options.repo).toBe("jixoai/opentray");
    expect(options.file).toBe("release.yml");
    expect(options.environment).toBe("npm-release");
  });

  test("Scenario: Given package kinds When manifests are generated Then package-specific product branches are unnecessary", () => {
    const platform = createPackageManifest("@opentray/darwin-arm64", "0.0.0", "platform");
    const extensionPlatform = createPackageManifest("@opentray/ext-webview-darwin-arm64", "0.0.0", "extension-platform");

    expect(platform.files).toEqual(["bin", "README.md"]);
    expect(platform.repository).toEqual({ type: "git", url: "https://github.com/jixoai/opentray" });
    expect(platform.publishConfig).toEqual({ access: "public" });
    expect(extensionPlatform.files).toEqual(["dist", "platforms", "README.md"]);
    expect(extensionPlatform.peerDependencies).toEqual({ opentray: ">=0.0.0" });
  });

  test("Scenario: Given npm view output When registry state is classified Then 404 is separate from hard errors", () => {
    expect(classifyRegistryResult({ exitCode: 0, stdout: '"0.0.0"', stderr: "" })).toEqual({
      type: "exists",
      version: "0.0.0",
    });
    expect(classifyRegistryResult({ exitCode: 1, stdout: "", stderr: "npm error code E404" })).toEqual({
      type: "missing",
    });
    expect(classifyRegistryResult({ exitCode: 1, stdout: "", stderr: "npm error code E403" })).toEqual({
      type: "error",
      message: "npm error code E403",
    });
  });

  test("Scenario: Given npm dist-tags output When latest exists Then publication can continue before packument cache settles", () => {
    expect(classifyDistTagResult({ exitCode: 0, stdout: "latest: 0.1.0", stderr: "" })).toEqual({
      type: "exists",
      version: "0.1.0",
    });
    expect(classifyDistTagResult({ exitCode: 0, stdout: "", stderr: "" })).toEqual({ type: "missing" });
  });

  test("Scenario: Given a trusted publisher response When claims match Then trust can be skipped", () => {
    const raw = JSON.stringify({
      type: "github",
      file: "release.yml",
      repository: "jixoai/opentray",
      environment: "npm-release",
      permissions: ["createPackage", "createStagedPackage"],
    });

    expect(trustMatches(raw, { repo: "jixoai/opentray", file: "release.yml", environment: "npm-release" })).toBe(true);
    expect(trustMatches(raw, { repo: "jixoai/opentray", file: "other.yml", environment: "npm-release" })).toBe(false);
  });

  test("Scenario: Given command output contains secrets When redacted Then no token password or OTP leaks", () => {
    const output = "token npm_abc123 password hunter2 otp 123456 authId=97b62083-645c-4ebf-93bd-1b77296cdbcf";

    expect(redact(output, ["hunter2"])).toBe(
      "token npm_<redacted> password <secret> otp <OTP> authId=<redacted>",
    );
  });

  test("Scenario: Given a scoped package name When no dir is provided Then workspace path is derived", () => {
    expect(defaultPackageDir("@opentray/ext-webview-windows-x64")).toBe("packages/ext-webview-windows-x64");
    expect(defaultPackageDir("opentray")).toBe("packages/opentray");
  });
});
