// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Declare the official WebView platform package closure as platform-neutral data.
// 2. Keep native package selection relative to this facade instead of consumer cwd.

import type { NativeExtensionPackageArtifact } from "opentray";

export const WEBVIEW_NATIVE_ARTIFACT = {
  kind: "package",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      packageName: "@opentray/ext-webview-darwin-arm64",
      libraryPath: "lib/libopentray_ext_webview.dylib",
    },
    "darwin-x64": {
      packageName: "@opentray/ext-webview-darwin-x64",
      libraryPath: "lib/libopentray_ext_webview.dylib",
    },
    "win32-arm64": {
      packageName: "@opentray/ext-webview-windows-arm64",
      libraryPath: "bin/opentray_ext_webview.dll",
    },
    "win32-x64": {
      packageName: "@opentray/ext-webview-windows-x64",
      libraryPath: "bin/opentray_ext_webview.dll",
    },
  },
} satisfies NativeExtensionPackageArtifact;
