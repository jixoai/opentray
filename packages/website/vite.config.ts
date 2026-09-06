/*
Orthogonal intents (maintained 2026-09-06; original user request: 新增 ./opentray
官网站点，AI 导出层随站点交付; extended 2026-09-06: 所有站点需要至少提供中英
两种语言的支持; extended 2026-09-07: 响应式品牌图片管线):
1. One vite pipeline for dev/build (sveltekit + tailwindcss v4 css-first).
   [image-pipeline] imagetools rides FIRST so `?w=…&format=webp;png&as=picture`
   imports resolve before any consumer plugin (Owner image-optimization law).
2. ONE llms.txt generation point: the registry llms-txt vite plugin, wired
   here and nowhere else (orchestrated double generation is forbidden by the
   llms-txt law); siteUrl is the project pages URL until the Owner cuts DNS.
   The locale split mirrors the site surface: en at the root, zh under
   /zh/ — each locale gets its own llms.txt index + per-page .md mirrors
   (absolute URLs); llms-full.txt follows the default (en) locale only.
3. Dev server pinned to port 13122 (unique per concurrent agent law).
4. __SITE_URL__ define: the same siteUrl baked into the client bundle so
   head hreflang alternates and the AI export share one canonical origin.
*/
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { imagetools } from 'vite-imagetools';
import { llmsTxt } from './vite-plugins/llms-txt.mjs';

// The AI export layer's canonical URL: the project pages path until the
// Owner cuts DNS over to the custom domain (SITE_URL + SITE_CNAME move
// together in the cutover — no code change beyond the env).
const siteUrl = process.env.SITE_URL ?? 'https://opentray.jixoai.com';

export default defineConfig({
  plugins: [
    // image pipeline (Owner law 2026-09-07): ?w=…&format=webp;png&as=picture
    // imports for raster brand assets; must run before the sveltekit plugin.
    imagetools(),
    sveltekit(),
    tailwindcss(),
    llmsTxt({
      distDir: 'dist',
      siteUrl,
      title: 'OpenTray',
      summary:
        'Desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems: a tray-first model (App / Tray / Session / Extension), a Rust core behind a packaged broker executable, an extension family, and a bundler-neutral packaging layer.',
      locale: { segments: ['zh'], default: '' },
    }),
  ],
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  server: { port: 13122 },
});
