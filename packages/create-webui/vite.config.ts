import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two static consumers:
// - wizard (index.html): served by the create-opentray wizard at / with
//   absolute /assets/... paths.
// - terminal.html / browse.html: dedicated generated-app windows served from
//   their local shell server → RELATIVE asset paths are required.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Bundle the ghostty-web renderer entry directly; its WASM resolves at
      // runtime document-relative, served by the wizard / shell server.
      "ghostty-web": fileURLToPath(
        new URL("./node_modules/ghostty-web/dist/ghostty-web.js", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        terminal: resolve(__dirname, "terminal.html"),
        browse: resolve(__dirname, "browse.html"),
      },
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js",
        entryFileNames: "assets/[name].js",
      },
    },
  },
})
