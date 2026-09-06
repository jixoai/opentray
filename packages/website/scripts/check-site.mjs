/*
Orthogonal intents (maintained 2026-09-06; original user request: 新增
./opentray 官网站点，产物须在配置的 base path 下可静态抽查; extended
2026-09-06: 所有站点需要至少提供中英两种语言的支持):
1. Static link check on the final dist/: every local src/href in each
   prerendered page (en index + zh mirror) must resolve to a file, under
   the base path the build was configured with (SITE_BASE; root mode when
   unset).
2. Base-path discipline: in subpath mode a root-absolute local reference
   that escapes the base is a hard failure (no hardcoded prefixes).
3. AI export sanity: llms.txt exists with an H1 + blockquote and absolute
   links only; the per-page .md mirror exists beside each page; the zh
   locale index (zh/llms.txt) and mirror (zh/index.md) exist too.
4. Locale surface: both pages carry the hreflang alternates
   (en / zh / x-default, absolute) and their own <html lang>.
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

// --- local references in each prerendered page ----------------------------
const pages = [
  { rel: 'index.html', url: '/' },
  { rel: 'zh/index.html', url: '/zh/' },
];
for (const pageInfo of pages) {
  const file = path.join(dist, pageInfo.rel);
  if (!existsSync(file)) {
    fail(`${pageInfo.rel} missing (locale mirror incomplete)`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const refs = new Set();
  for (const attr of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = attr[1];
    if (/^(https?:|mailto:|data:|#|mailto)/.test(value)) continue;
    refs.add(value);
  }
  if (refs.size === 0) fail(`no local references found in ${pageInfo.rel} (unexpected)`);
  for (const ref of refs) {
    const clean = ref.split('?')[0].split('#')[0];
    // Nested prerendered pages ship page-relative refs (../_app/…, ../zh/);
    // root-absolute refs resolve from the dist root and must stay in-base.
    const onDisk = ref.startsWith('/')
      ? path.join(dist, clean.replace(/^\//, ''))
      : path.resolve(path.dirname(file), clean);
    if (!onDisk.startsWith(dist)) {
      fail(`reference escapes the dist root: ${ref}`);
    } else if (!existsSync(onDisk)) {
      fail(`local reference does not resolve: ${ref}`);
    } else if (base !== '' && ref.startsWith('/') && !ref.startsWith(`${base}/`)) {
      fail(`reference escapes the base path (${base}): ${ref}`);
    }
  }
  if (failures.length === 0 && refs.size > 0)
    ok(`all ${refs.size} local references in ${pageInfo.rel} resolve under dist${base}`);

  // hreflang alternates: en + zh + x-default, absolute URLs.
  for (const tag of ['en', 'zh', 'x-default']) {
    const pattern = new RegExp(
      `<link[^>]*rel="alternate"[^>]*hreflang="${tag}"[^>]*href="https?://[^"]+"`,
    );
    if (!pattern.test(html)) fail(`${pageInfo.rel}: missing absolute hreflang="${tag}" alternate`);
  }
  const expectedLang = pageInfo.rel === 'index.html' ? 'en' : 'zh';
  if (!new RegExp(`<html[^>]*lang="${expectedLang}"`).test(html))
    fail(`${pageInfo.rel}: expected <html lang="${expectedLang}">`);
  else ok(`${pageInfo.rel}: lang="${expectedLang}" + hreflang alternates present`);
}

// --- AI export layer -------------------------------------------------------
const llmsFiles = [
  { rel: 'llms.txt', expectOtherLanguages: true },
  { rel: 'zh/llms.txt', expectOtherLanguages: false },
];
for (const llms of llmsFiles) {
  const file = path.join(dist, llms.rel);
  if (!existsSync(file)) {
    fail(`dist/${llms.rel} missing`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (!/^# OpenTray\n/m.test(text)) fail(`${llms.rel}: expected H1 "# OpenTray"`);
  else ok(`${llms.rel} H1 present`);
  if (!/^> /m.test(text)) fail(`${llms.rel}: expected blockquote summary`);
  else ok(`${llms.rel} summary present`);
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  const relative = links.filter((l) => !/^(https?:|mailto:)/.test(l));
  if (relative.length > 0) fail(`${llms.rel}: non-absolute links: ${relative.slice(0, 3).join(', ')}`);
  else ok(`${llms.rel}: all ${links.length} links absolute`);
  // the default-locale index must link the zh edition ("Other languages")
  if (llms.expectOtherLanguages && !/## Other languages[\s\S]*zh\/llms\.txt/.test(text))
    fail('llms.txt: expected an "Other languages" section linking zh/llms.txt');
}
const mirrors = ['index.md', 'zh/index.md'];
for (const mirror of mirrors) {
  const file = path.join(dist, mirror);
  if (!existsSync(file)) fail(`dist/${mirror} mirror missing`);
  else ok(`dist/${mirror} mirror exists`);
}

// --- gate -------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`check-site: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-site: PASS');
