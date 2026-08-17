// Ship the composition background PNGs beside the built bundle: the
// icon-compose module resolves assets/ relative to its output directory.
import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "assets");
const target = join(root, "dist", "assets");
await mkdir(target, { recursive: true });
let copied = 0;
for (const entry of await readdir(source)) {
  if (!entry.endsWith(".png")) continue;
  await cp(join(source, entry), join(target, entry));
  copied += 1;
}
console.log(`assets: copied ${copied} background png(s) into dist/assets`);
