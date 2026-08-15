// ghostty-web's WASM loader resolves document-relative candidates
// (./ghostty-vt.wasm, /ghostty-vt.wasm). Vite cannot see that runtime fetch,
// so place the wasm beside the built index.html at the dist root.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ghosttyRoot = dirname(dirname(require.resolve("ghostty-web")));
copyFileSync(
  resolve(ghosttyRoot, "ghostty-vt.wasm"),
  resolve(root, "dist", "ghostty-vt.wasm"),
);
console.log(`copied ghostty wasm into dist root (from ${ghosttyRoot})`);
