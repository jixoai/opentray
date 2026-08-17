import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Real-timer tests (discovery polling, materialize pipelines) are sensitive
  // to CPU contention under parallel workers; keep files sequential.
  test: {
    fileParallelism: false,
    // Real-timer tests share the process with real sharp pipelines (1024²
    // icon compositions) whose CPU bursts stall polling loops; 5s per-test
    // flaked under that contention.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@opentray/spec": resolve(__dirname, "../spec/src/index.ts"),
      "@opentray/packaging": resolve(__dirname, "../packaging/src/index.ts"),
      "@opentray/vite-plugin": resolve(__dirname, "../vite-plugin/src/index.ts"),
      "@create-opentray/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@create-opentray/cli": resolve(__dirname, "packages/cli/src/index.ts"),
    },
  },
});
