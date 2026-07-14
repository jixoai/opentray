// Orthogonal intents (2026-07-14; original user request: `example:webview-control` exits after Vite prints readiness):
// 1. Keep the examples app reachable from a native Local origin.
// 2. Bind one deterministic loopback address across Vite and WebView.
// 3. Serve deterministic slow-download test data without a remote dependency.

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Loopback-only dev/preview server. The host the WebView connects to must
// classify as Local (localhost/127.0.0.1/::1) so the default
// nativeApiPolicy.defaultSrc: ["'local'"] admits every capability without
// per-route policy overrides. Use one IPv4 address so Windows localhost DNS
// ordering cannot split the selected port and the WebView connection.
export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), slowDownloadMiddleware()],
  server: {
    host: "127.0.0.1",
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    strictPort: false,
  },
  build: {
    target: "esnext",
  },
});

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
            setImmediate(writeNext);
          }
        };
        writeNext();
      });
    },
  };
}
