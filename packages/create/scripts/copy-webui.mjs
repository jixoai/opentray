// Copies the wizard WebUI into dist so the published package serves static
// assets without a bundler. Keeps `src/webui/index.html` the single source.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/webui/index.html");
const target = resolve(root, "dist/webui/index.html");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied wizard webui: ${source} -> ${target}`);
