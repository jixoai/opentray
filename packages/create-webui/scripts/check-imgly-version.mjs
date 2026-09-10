// Guard: the pinned IMGLY_DATA_VERSION in subject-extraction.ts must track
// the installed @imgly/background-removal — the wizard proxies model assets
// under that version, and a stale pin would fetch a CDN tree the runtime
// never validates against. (Runs as part of `test`; node context only.)
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const entry = require.resolve("@imgly/background-removal");
const root = entry.slice(0, entry.lastIndexOf("/dist/"));
const { version } = require(`${root}/package.json`);
const source = await readFile(new URL("../src/subject-extraction.ts", import.meta.url), "utf8");
const pin = /IMGLY_DATA_VERSION = "([^"]+)"/.exec(source)?.[1];
if (pin !== version) {
  console.error(`IMGLY_DATA_VERSION pin "${pin}" != installed @imgly/background-removal ${version}`);
  process.exit(1);
}
console.log(`imgly data version pin ok (${version})`);
