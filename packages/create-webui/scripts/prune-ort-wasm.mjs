// Prune dead-weight ONNX Runtime wasm emitted into dist/assets (imgly
// background-removal issue #147): at runtime the ort binaries load from the
// package's publicPath (vendor CDN), so Vite's copies are pure dead weight —
// and this dist gets vendored into the published create package, where 24 MB
// of unused wasm must not ship.
import { readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(root, "dist", "assets");
let removed = 0;
for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.startsWith("ort-") && entry.name.endsWith(".wasm")) {
    await rm(resolve(assetsDir, entry.name));
    console.log(`pruned dead ort wasm: dist/assets/${entry.name}`);
    removed += 1;
  }
}
if (removed === 0) {
  console.log("no dead ort wasm found in dist/assets");
}
