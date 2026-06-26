import { openTrayVitePlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
      nativeArtifacts: {
        "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
      },
    }),
  ],
};
