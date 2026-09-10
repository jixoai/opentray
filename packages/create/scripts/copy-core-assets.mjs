// Ship the runtime assets the BUNDLED icon kernel resolves at runtime.
// The bundled kernel's assetsDirectory() is join(<module dir>, "..", "assets"),
// which from dist/ resolves to this package's ROOT assets/ — proven live on
// 2026-09-11: both the glyph font and the compose backgrounds ENOENTed
// against packages/create/assets until staged there. Two consumers, two dirs:
//  - package-root assets/: the server-side kernel (glyph font for defaults,
//    iOS background PNGs for icon composition). Without the font, every
//    default (first-letter) icon generation fails the whole materialize run;
//    without the backgrounds, composition silently degrades to source-direct.
//  - dist/assets: served at /assets/ by the wizard server for the browser-side
//    icon compose preview. The PNGs live in the Core package
//    (@create-opentray/core); the font lives in the workspace @opentray/icon.
import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const coreAssets = fileURLToPath(new URL("../packages/core/assets", import.meta.url));
const iconAssets = fileURLToPath(new URL("../../icon/assets", import.meta.url));

const rootAssets = join(root, "assets");
await mkdir(rootAssets, { recursive: true });
const target = join(root, "dist", "assets");
await mkdir(target, { recursive: true });

let backgrounds = 0;
for (const entry of await readdir(coreAssets)) {
  if (!entry.endsWith(".png")) continue;
  await cp(join(coreAssets, entry), join(target, entry));
  await cp(join(coreAssets, entry), join(rootAssets, entry));
  backgrounds += 1;
}
if (backgrounds === 0) {
  throw new Error("background staging found no PNG assets in @create-opentray/core");
}
console.log(`assets: staged ${backgrounds} background png(s) into dist/assets and package assets/`);

let fonts = 0;
for (const entry of await readdir(iconAssets)) {
  if (!entry.endsWith(".ttf") && !entry.endsWith(".OFL.txt")) continue;
  await cp(join(iconAssets, entry), join(rootAssets, entry));
  fonts += 1;
}
if (fonts === 0) {
  throw new Error("glyph font staging found no ttf/OFL assets in @opentray/icon");
}
console.log(`assets: staged ${fonts} glyph font file(s) into package assets/`);
