// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Declare the official Lynx platform package closure as platform-neutral data.
// 2. Keep native package selection relative to this facade instead of consumer cwd.

import type { NativeExtensionPackageArtifact } from "opentray";

export const LYNX_NATIVE_ARTIFACT = {
  kind: "package",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      packageName: "@opentray/ext-lynx-darwin-arm64",
      libraryPath: "lib/libopentray_ext_lynx.dylib",
    },
    "darwin-x64": {
      packageName: "@opentray/ext-lynx-darwin-x64",
      libraryPath: "lib/libopentray_ext_lynx.dylib",
    },
  },
} satisfies NativeExtensionPackageArtifact;
