// Ship the composition background PNGs beside the built bundle: the bundled
// icon-compose module resolves assets/ relative to its output directory.
// The PNGs now live in the Core package (@create-opentray/core assets).
import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const coreAssets = fileURLToPath(new URL("../packages/core/assets", import.meta.url));
const target = join(root, "dist", "assets");
await mkdir(target, { recursive: true });
let copied = 0;
for (const entry of await readdir(coreAssets)) {
  if (!entry.endsWith(".png")) continue;
  await cp(join(coreAssets, entry), join(target, entry));
  copied += 1;
}
console.log(`assets: copied ${copied} background png(s) into dist/assets`);
