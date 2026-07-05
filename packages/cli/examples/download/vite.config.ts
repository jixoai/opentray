import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// A Vite middleware that streams a deterministic payload of the requested size
// with an optional per-chunk delay. This gives the download example a stable,
// reproducible source of multi-byte downloads that produce visible progress
// events, without depending on external CDN availability.
function slowDownloadMiddleware(): Plugin {
  const DEFAULT_SIZE = 4 * 1024 * 1024;
  const MAX_SIZE = 64 * 1024 * 1024;
  const DEFAULT_CHUNK = 64 * 1024;
  const parseSize = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, MAX_SIZE);
  };
  const parseDelay = (raw: string | undefined): number => {
    const n = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(n) || n < 0) return 15;
    return Math.min(n, 2000);
  };

  return {
    name: "opentray-slow-download",
    configureServer(server) {
      server.middlewares.use("/slow-download", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const params = url.searchParams;
        const size = parseSize(params.get("size") ?? undefined, DEFAULT_SIZE);
        const chunkSize = Math.min(
          parseSize(params.get("chunk") ?? undefined, DEFAULT_CHUNK),
          size,
        );
        const delay = parseDelay(params.get("delay") ?? undefined);
        const filename =
          params.get("filename") ?? `opentray-slow-${size}.bin`;

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(size));
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Cache-Control", "no-store");

        // Deterministic chunk content so the bytes are reproducible.
        const chunk = Buffer.alloc(chunkSize, 0x61);
        let written = 0;
        const writeNext = (): void => {
          if (written >= size) {
            res.end();
            return;
          }
          const remaining = size - written;
          const slice =
            remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
          res.write(slice);
          written += slice.length;
          if (delay > 0) {
            setTimeout(writeNext, delay);
          } else {
            // Yield to the event loop so progress events stay observable even
            // without an artificial delay.
            setImmediate(writeNext);
          }
        };
        writeNext();
      });
    },
  };
}

// Single-page dev/preview config for the OpenTray download example.
// Vite binds to loopback only so the native WebView classifies the page as `Local`,
// which means the default `nativeApiPolicy.defaultSrc: ["'local'"]` admits every capability.
export default defineConfig({
  plugins: [tailwindcss(), svelte(), slowDownloadMiddleware()],
  // Listen on loopback: the host must resolve as `Local` (localhost/127.0.0.1/::1).
  // Don't pin a port — let vite pick 5173 (or the next free one) so multiple
  // example runs don't collide. The launcher parses the actual port from stdout.
  server: {
    host: "localhost",
    strictPort: false,
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  build: {
    target: "esnext",
  },
});
