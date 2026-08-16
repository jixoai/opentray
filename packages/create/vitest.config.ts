import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Real-timer tests (discovery polling, materialize pipelines) are sensitive
  // to CPU contention under parallel workers; keep files sequential.
  test: {
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@opentray/spec": resolve(__dirname, "../spec/src/index.ts"),
      "@opentray/packaging": resolve(__dirname, "../packaging/src/index.ts"),
      "@opentray/vite-plugin": resolve(__dirname, "../vite-plugin/src/index.ts"),
    },
  },
});
