// Vendor the browser subject-extraction model assets into the webui dist so
// the wizard runs fully offline (owner decision: ship the model inline with
// create-opentray). Downloads the isnet_quint8 model plus both ONNX Runtime
// wasm/mjs loader pairs (cpu + webgpu) from the IMG.LY CDN as content-
// addressed chunks, per resources.json — exactly what the runtime fetches
// from publicPath. A local .imgly-cache keeps repeat builds offline-fast;
// failures only warn (the webui falls back to the CDN publicPath at runtime).
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// The package exports map does not expose ./package.json — resolve the entry
// and walk up to the package root instead.
const pkgRoot = dirname(dirname(require.resolve("@imgly/background-removal")));
const pkgVersion = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8")).version;
const cdnBase = `https://staticimgly.com/@imgly/background-removal-data/${pkgVersion}/dist/`;
const cacheDir = resolve(root, ".imgly-cache");
const outDir = resolve(root, "dist", "imgly-data");

// Exactly the keys the runtime resolves for { model: "isnet_quint8",
// device: "gpu" } (cpu fallback shares the non-jsep wasm): the model, both
// wasm binaries, and both .mjs loaders (createOnnxSession loads .mjs too).
const REQUIRED_KEYS = [
  "/models/isnet_quint8",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
];

const fetchOrCache = async (name, expectedSize) => {
  const cached = resolve(cacheDir, name);
  const cachedBytes = await readFile(cached).catch(() => undefined);
  if (cachedBytes !== undefined && (expectedSize === undefined || cachedBytes.length === expectedSize)) {
    return cachedBytes;
  }
  const response = await fetch(new URL(name, cdnBase).toString());
  if (!response.ok) {
    throw new Error(`fetch ${name} failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, bytes);
  return bytes;
};

try {
  const resourcesRaw = await fetchOrCache("resources.json");
  const resources = JSON.parse(resourcesRaw.toString("utf8"));
  const chunkNames = new Set();
  for (const key of REQUIRED_KEYS) {
    const entry = resources[key];
    if (entry === undefined) {
      throw new Error(`resources.json has no entry for ${key}`);
    }
    for (const chunk of entry.chunks) {
      chunkNames.add(chunk.name);
    }
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  let total = 0;
  for (const name of chunkNames) {
    const bytes = await fetchOrCache(name);
    await writeFile(resolve(outDir, name), bytes);
    total += bytes.length;
  }
  await writeFile(resolve(outDir, "resources.json"), resourcesRaw);
  console.log(
    `vendored ${chunkNames.size} imgly data chunks (~${Math.round(total / 1e6)} MB) for @imgly/background-removal ${pkgVersion} → dist/imgly-data`,
  );
} catch (error) {
  // Dev builds may be offline; the webui falls back to the CDN publicPath.
  console.warn(`warn: imgly data vendoring skipped (${String(error)}) — subject extraction will use the CDN`);
}
