import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Filesystem/process integration tests mutate real temp directories and
  // spawn real child processes; keep files sequential.
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@opentray/spec": resolve(__dirname, "../../../spec/src/index.ts"),
      "@opentray/packaging": resolve(__dirname, "../../../packaging/src/index.ts"),
      "@opentray/vite-plugin": resolve(__dirname, "../../../vite-plugin/src/index.ts"),
    },
  },
});
