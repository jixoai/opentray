/*
Orthogonal intents (maintained 2026-09-06; original user request: 新增
./opentray 官网站点，CNAME 自定义域 Owner 管理所以用构建开关门控):
1. Single build entry: run `vite build` (SvelteKit adapter-static writes
   dist/; the registry llms-txt vite plugin is the ONE generation point and
   fires inside vite's closeBundle — nothing here generates AI exports).
2. CNAME production gate: SITE_CNAME=1 switches svelte.config.js to root
   serving and appends the Owner-managed custom domain as dist/CNAME; the
   domain value comes from SITE_DOMAIN (never invented here).
3. Subpath mode needs no post-processing: SITE_BASE=/opentray feeds
   kit.paths.base directly.
*/
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// vite's exports hide ./bin/vite.js — resolve the bin through vite's own
// package.json (tech-stack law, unipty precedent).
const require = createRequire(import.meta.url);
const vitePkg = require.resolve('vite/package.json', { paths: [pkgRoot] });
const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');

const build = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: pkgRoot,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

// CNAME gate — runs AFTER vite build; llms.txt never includes CNAME (it is
// not HTML), so the export layer stays byte-stable across both modes.
if (process.env.SITE_CNAME === '1') {
  const domain = process.env.SITE_DOMAIN;
  if (!domain) {
    console.error('build: SITE_CNAME=1 requires SITE_DOMAIN (the Owner-managed custom domain)');
    process.exit(1);
  }
  writeFileSync(path.join(pkgRoot, 'dist', 'CNAME'), `${domain}\n`);
  console.log(`build: dist/CNAME written (${domain}) — root serving mode`);
}
