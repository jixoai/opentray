import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Static build consumed by the create-opentray wizard server: everything is
// emitted under `dist/` with stable /assets/... paths the wizard server
// whitelists.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Bundle the ghostty-web renderer entry directly; its WASM resolves at
      // runtime document-relative (/ghostty-vt.wasm), served by the wizard.
      "ghostty-web": fileURLToPath(
        new URL("./node_modules/ghostty-web/dist/ghostty-web.js", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js",
        entryFileNames: "assets/[name].js",
      },
    },
  },
});
