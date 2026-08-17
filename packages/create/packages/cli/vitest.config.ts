import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@opentray/spec": resolve(__dirname, "../../../spec/src/index.ts"),
      "@opentray/packaging": resolve(__dirname, "../../../packaging/src/index.ts"),
      "@create-opentray/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
