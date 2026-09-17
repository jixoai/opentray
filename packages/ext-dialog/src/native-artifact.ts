// Orthogonal intents (2026-09-17; add-ext-dialog batch C):
// 1. Declare the official Dialog platform library catalog as platform-neutral
//    data shipped inside this facade package (design reference section 6.2).
// 2. Keep the embedded identity chain (facade package.json + contract.json)
//    relative to this facade instead of consumer cwd.

import type { NativeExtensionEmbeddedArtifact } from "opentray";

export const DIALOG_NATIVE_ARTIFACT = {
  kind: "embedded",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      libraryPath: "platforms/darwin-arm64/libopentray_ext_dialog.dylib",
    },
    "darwin-x64": {
      libraryPath: "platforms/darwin-x64/libopentray_ext_dialog.dylib",
    },
    "win32-arm64": {
      libraryPath: "platforms/win32-arm64/opentray_ext_dialog.dll",
    },
    "win32-x64": {
      libraryPath: "platforms/win32-x64/opentray_ext_dialog.dll",
    },
  },
} satisfies NativeExtensionEmbeddedArtifact;
