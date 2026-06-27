import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@opentray/packaging": resolve(__dirname, "../packaging/src/index.ts"),
      "@opentray/esbuild-plugin": resolve(__dirname, "./src/index.ts"),
    },
  },
});
