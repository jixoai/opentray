// Orthogonal intents (2026-09-18; add-ext-opener task 4.1):
// 1. Declare the official opener platform library catalog as
//    platform-neutral data shipped inside this facade package (design
//    reference section 3, mirroring the frozen embedded layout established
//    by add-ext-dialog section 6.2 and generalized by add-ext-sound).
// 2. Keep the embedded identity chain (facade package.json +
//    contract.json) relative to this facade instead of consumer cwd.

import type { NativeExtensionEmbeddedArtifact } from "opentray";

export const OPENER_NATIVE_ARTIFACT = {
  kind: "embedded",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      libraryPath: "platforms/darwin-arm64/libopentray_ext_opener.dylib",
    },
    "darwin-x64": {
      libraryPath: "platforms/darwin-x64/libopentray_ext_opener.dylib",
    },
    "win32-arm64": {
      libraryPath: "platforms/win32-arm64/opentray_ext_opener.dll",
    },
    "win32-x64": {
      libraryPath: "platforms/win32-x64/opentray_ext_opener.dll",
    },
  },
} satisfies NativeExtensionEmbeddedArtifact;
