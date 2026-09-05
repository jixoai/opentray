/*
Orthogonal intents (maintained 2026-09-06; original user request: 新增
./opentray 官网站点，产物须在配置的 base path 下可静态抽查):
1. Static link check on the final dist/: every local src/href in the
   prerendered HTML must resolve to a file, under the base path the build
   was configured with (SITE_BASE; root mode when unset).
2. Base-path discipline: in subpath mode a root-absolute local reference
   that escapes the base is a hard failure (no hardcoded prefixes).
3. AI export sanity: llms.txt exists with an H1 + blockquote and absolute
   links only; the per-page .md mirror exists beside the page.
*/
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(pkgRoot, 'dist');

const rawBase = (process.env.SITE_BASE ?? '').replace(/^\/+|\/+$/g, '');
const base = rawBase === '' ? '' : `/${rawBase}`;

const failures = [];
const ok = (label) => console.log(`  ok  ${label}`);
const fail = (label) => {
  failures.push(label);
  console.log(`FAIL  ${label}`);
};

const indexHtml = path.join(dist, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('check-site: dist/index.html missing — build first');
  process.exit(1);
}
ok('dist/index.html exists');

// --- local references in the prerendered page -----------------------------
const html = readFileSync(indexHtml, 'utf8');
const refs = new Set();
for (const attr of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = attr[1];
  if (/^(https?:|mailto:|data:|#|mailto)/.test(value)) continue;
  refs.add(value);
}
if (refs.size === 0) fail('no local references found in index.html (unexpected)');
for (const ref of refs) {
  const onDisk = path.join(dist, ref.replace(/^\//, '').split('?')[0].split('#')[0]);
  if (!existsSync(onDisk)) {
    fail(`local reference does not resolve: ${ref}`);
  } else if (base !== '' && ref.startsWith('/') && !ref.startsWith(`${base}/`)) {
    fail(`reference escapes the base path (${base}): ${ref}`);
  }
}
if (failures.length === 0 && refs.size > 0) ok(`all ${refs.size} local references resolve under dist${base}`);

// --- AI export layer -------------------------------------------------------
const llmsTxt = path.join(dist, 'llms.txt');
if (!existsSync(llmsTxt)) {
  fail('dist/llms.txt missing');
} else {
  const text = readFileSync(llmsTxt, 'utf8');
  if (!/^# OpenTray\n/m.test(text)) fail('llms.txt: expected H1 "# OpenTray"');
  else ok('llms.txt H1 present');
  if (!/^> /m.test(text)) fail('llms.txt: expected blockquote summary');
  else ok('llms.txt summary present');
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  const relative = links.filter((l) => !/^(https?:|mailto:)/.test(l));
  if (relative.length > 0) fail(`llms.txt: non-absolute links: ${relative.slice(0, 3).join(', ')}`);
  else ok(`llms.txt: all ${links.length} links absolute`);
}
const mirror = path.join(dist, 'index.md');
if (!existsSync(mirror)) fail('dist/index.md mirror missing');
else ok('dist/index.md mirror exists');

// --- gate -------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`check-site: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-site: PASS');
