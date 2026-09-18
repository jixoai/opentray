// Orthogonal intents (2026-09-18; add-ext-notification batch C):
// 1. Declare the official notification platform library catalog as
//    platform-neutral data shipped inside this facade package (design
//    reference section 3, the archived dialog/sound embedded packaging law).
// 2. Keep the embedded identity chain (facade package.json + contract.json)
//    relative to this facade instead of consumer cwd.

import type { NativeExtensionEmbeddedArtifact } from "opentray";

export const NOTIFICATION_NATIVE_ARTIFACT = {
  kind: "embedded",
  packageJsonUrl: new URL("../package.json", import.meta.url).href,
  contractManifestUrl: new URL("../contract.json", import.meta.url).href,
  targets: {
    "darwin-arm64": {
      libraryPath: "platforms/darwin-arm64/libopentray_ext_notification.dylib",
    },
    "darwin-x64": {
      libraryPath: "platforms/darwin-x64/libopentray_ext_notification.dylib",
    },
    "win32-arm64": {
      libraryPath: "platforms/win32-arm64/opentray_ext_notification.dll",
    },
    "win32-x64": {
      libraryPath: "platforms/win32-x64/opentray_ext_notification.dll",
    },
  },
} satisfies NativeExtensionEmbeddedArtifact;
