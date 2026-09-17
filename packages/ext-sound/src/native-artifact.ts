// Orthogonal intents (2026-09-17; add-ext-sound task 4.1):
// 1. Declare the official Sound platform library catalog as platform-neutral
//    data shipped inside this facade package (design reference section 3,
//    mirroring the frozen embedded layout established by add-ext-dialog
//    section 6.2).
// 2. Keep the embedded identity chain (facade package.json + contract.json)
//    relative to this facade instead of consumer cwd.

import type { NativeExtensionEmbeddedArtifact } from "opentray";

export const SOUND_NATIVE_ARTIFACT = {
  kind: "embedded",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      libraryPath: "platforms/darwin-arm64/libopentray_ext_sound.dylib",
    },
    "darwin-x64": {
      libraryPath: "platforms/darwin-x64/libopentray_ext_sound.dylib",
    },
    "win32-arm64": {
      libraryPath: "platforms/win32-arm64/opentray_ext_sound.dll",
    },
    "win32-x64": {
      libraryPath: "platforms/win32-x64/opentray_ext_sound.dll",
    },
  },
} satisfies NativeExtensionEmbeddedArtifact;
