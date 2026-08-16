// Generated-app window pages are served from a nested local server route, so
// their asset references must be RELATIVE (./assets/...), unlike the wizard.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const page of ["terminal.html", "browse.html"]) {
  const path = resolve(root, "dist", page);
  const html = await readFile(path, "utf8");
  const fixed = html
    .replace(/(src|href)="#\/?/gu, '$1="./')
    .replace(/(src|href)="\//gu, '$1="./');
  await writeFile(path, fixed);
  console.log(`${page} asset paths made relative`);
}
