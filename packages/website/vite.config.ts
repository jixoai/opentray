/*
Orthogonal intents (maintained 2026-09-06; original user request: 新增 ./opentray
官网站点，AI 导出层随站点交付):
1. One vite pipeline for dev/build (sveltekit + tailwindcss v4 css-first).
2. ONE llms.txt generation point: the registry llms-txt vite plugin, wired
   here and nowhere else (orchestrated double generation is forbidden by the
   llms-txt law); siteUrl is the project pages URL until the Owner cuts DNS.
3. Dev server pinned to port 13122 (unique per concurrent agent law).
*/
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { llmsTxt } from './vite-plugins/llms-txt.mjs';

// The AI export layer's canonical URL: the project pages path until the
// Owner cuts DNS over to the custom domain (SITE_URL + SITE_CNAME move
// together in the cutover — no code change beyond the env).
const siteUrl = process.env.SITE_URL ?? 'https://jixoai.github.io/opentray';

export default defineConfig({
  plugins: [
    sveltekit(),
    tailwindcss(),
    llmsTxt({
      distDir: 'dist',
      siteUrl,
      title: 'OpenTray',
      summary:
        'Desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems: a tray-first model (App / Tray / Session / Extension), a Rust core behind a packaged broker executable, an extension family, and a bundler-neutral packaging layer.',
    }),
  ],
  server: { port: 13122 },
});
