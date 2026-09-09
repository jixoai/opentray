/**
 * Bundled asset resolution. Assets live at the package root (`assets/`),
 * exactly one level above both `src/` (source checkout) and `dist/` (built
 * output), so the resolution is uniform: package.json `files` ships both
 * `dist` and `assets`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const assetsDirectory = (): string =>
  join(moduleDirectory, "..", "assets");
