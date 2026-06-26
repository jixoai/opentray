import { stageOpenTrayPackage } from "../src/index";

await stageOpenTrayPackage({
  app: { id: "com.example.build", name: "Build" },
  outDir: "dist",
  entry: "src/main.ts",
  adapter: { name: "custom", mode: "production" },
  runtimeHost: { source: "target/release/build-tray-host" },
  nativeArtifacts: {
    "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
  },
});
