import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@opentray/spec": fromRoot("./packages/spec/src/index.ts"),
      "@opentray/ext-webview": fromRoot("./packages/ext-webview/src/index.ts"),
      opentray: fromRoot("./packages/cli/src/index.ts"),
    },
  },
});
