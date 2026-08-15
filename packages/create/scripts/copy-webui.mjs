// Copies the wizard WebUI and its vendored terminal-renderer assets into dist
// so the published package serves everything statically without a bundler.
// `src/webui/index.html` remains the single hand-written source.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/webui/index.html");
const webuiDir = resolve(root, "dist/webui");

mkdirSync(webuiDir, { recursive: true });
copyFileSync(source, resolve(webuiDir, "index.html"));
console.log(`copied wizard webui: ${source} -> ${webuiDir}/index.html`);

// Vendor ghostty-web (xterm.js-compatible WASM terminal) next to the page so
// the module-relative `./ghostty-vt.wasm` resolution works from /vendor/.
const require = createRequire(import.meta.url);
const vendorDir = resolve(webuiDir, "vendor");
mkdirSync(vendorDir, { recursive: true });
// Deep imports are blocked by ghostty-web's exports map; resolve the main
// module and walk from the package root.
const ghosttyRoot = dirname(dirname(require.resolve("ghostty-web")));
const assets = [
  [resolve(ghosttyRoot, "dist/ghostty-web.js"), "ghostty-web.js"],
  [resolve(ghosttyRoot, "ghostty-vt.wasm"), "ghostty-vt.wasm"],
];
for (const [from, name] of assets) {
  copyFileSync(from, resolve(vendorDir, name));
  console.log(`vendored terminal asset: ${from} -> ${vendorDir}/${name}`);
}

// Sanity: the vendor directory must contain exactly the whitelisted assets.
const vendored = readdirSync(vendorDir).sort();
if (vendored.join(",") !== "ghostty-vt.wasm,ghostty-web.js") {
  throw new Error(`unexpected vendor assets: ${vendored.join(",")}`);
}
