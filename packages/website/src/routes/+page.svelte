<!--
  Orthogonal intents (maintained 2026-09-06; original user request: 新增
  ./opentray 官网站点，内容一律取自 README 定位、不得虚构):
  1. One-page narrative: registry hero (positioning + copy CTA + terminal),
     quick-start card (the README first-app sample), features grid (the
     platform surface), workspace package table, ecosystem links.
  2. Every claim is a README fact; no invented capabilities or dates.
  3. Motion law: the hero owns its cascade, card-grid owns its children's
     entrance (cards never carry data-reveal); other sections ride the
     theme's scroll-driven [data-reveal] hooks.
-->
<script lang="ts">
  import HeroSection from '$lib/ui/hero-section/hero-section.svelte';
  import SectionCard from '$lib/ui/section-card/section-card.svelte';
  import CardGrid from '$lib/ui/card-grid/card-grid.svelte';
  import TerminalCard from '$lib/ui/terminal-card/terminal-card.svelte';
  import PressButton from '$lib/ui/press-button/press-button.svelte';
  import CodeBlock from '$lib/components/code-block.svelte';
  import {
    APP_MODE_GUIDE_URL,
    CREATE_APP_GUIDE_URL,
    GITHUB_URL,
    LYNX_EXT_URL,
    NPM_URL,
  } from '$lib/constants';

  // The README first-app sample, verbatim in behavior (import path, icon,
  // menu shape, runtime identity options).
  const quickStart = String.raw`import {
  createTray,
  type CreateTrayHandle,
  type CreateTrayOptions,
  type TrayIcon,
} from "opentray";

const icon: TrayIcon = { "text-only": "OT" };
let tray: CreateTrayHandle;
const options: CreateTrayOptions = {
  id: "com.example.first-app",
  icon,
  menu: {
    items: [
      {
        title: "Quit",
        primaryEvent: true,
        onMenuClick: () => void tray.destroy(),
      },
    ],
  },
};

tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
});`;

  // Feature grid: the platform surface from the README workspace table and
  // API sections — one atom per card, README facts only.
  const features = [
    {
      id: 'tray-first',
      eyebrow: 'Platform model',
      title: 'Tray-first by design',
      body: 'App is the caller-owned runtime identity and isolation boundary. Tray is one desktop status atom owned by that app/runtime. Session is the live source of authority for tray events and mutations. Extension is an optional native capability atom scoped to app and tray.',
      detail: 'App · Tray · Session · Extension',
    },
    {
      id: 'create-tray',
      eyebrow: 'SDK',
      title: 'createTray() is the whole entry',
      body: 'Application code calls createTray() directly and owns foreground/background lifetime itself. Top-level createTray(...) and its returned setMenu(...) accept app-facing menu shorthand; lower-level createClient(...) stays protocol-only for tools that need exact wire shapes.',
      detail: 'opentray · menu shorthand · typed handles',
    },
    {
      id: 'broker',
      eyebrow: 'Rust core',
      title: 'A broker, not an addon',
      body: 'The default createTray() transport targets the local runtime host and starts it on first use when needed. Ordinary app code talks to the packaged opentray executable through the public tray/session protocol — no Node addon, no worker split for tray work.',
      detail: 'tray/session protocol · auto-started host',
    },
    {
      id: 'create-opentray',
      eyebrow: 'Scaffold',
      title: 'Wrap a command into an app',
      body: 'Already have a command that serves HTTP locally? npx create-opentray wraps it into an OpenTray-hosted app — interactively through the browser wizard (create-opentray web), fully non-interactively (create-opentray create --app-id … --exec …), or through the built-in AI skill (npx create-opentray skill).',
      detail: 'npx create-opentray · web · create · skill',
    },
    {
      id: 'extensions',
      eyebrow: 'Extension family',
      title: 'Native capabilities as atoms',
      body: '@opentray/ext-webview is the rich popup facade — its windows are tray-owned utilities by default, and style.appMode makes one behave as an ordinary desktop window (taskbar/Alt-Tab, Dock/Command-Tab). @opentray/ext-badge adds badge/progress/overlay APIs; @opentray/ext-island is the roadmap dynamic island extension.',
      detail: 'ext-webview · ext-badge · ext-island',
    },
    {
      id: 'packaging',
      eyebrow: 'Packaging layer',
      title: 'Bundler-neutral staging',
      body: '@opentray/packaging stages runtime executables, native sidecars, and companion assets into app-id-derived output paths and writes an opentray-app-manifest.json manifest. Adapters ship for Vite, tsdown, esbuild, and webpack — all four write the same manifest shape.',
      detail: 'opentray-app-manifest.json · 4 adapters',
    },
    {
      id: 'binaries',
      eyebrow: 'Platform runtimes',
      title: 'Per-platform binaries',
      body: 'Platform runtime packages such as @opentray/darwin-arm64 carry bin/opentray or bin/opentray.exe. Packaging stays a build-layer concern: it stages artifacts and emits manifest truth — tray lifecycle, session authority, and extension dispatch stay with the runtime.',
      detail: '@opentray/<os>-<arch> · bin/opentray',
    },
    {
      id: 'dist-tags',
      eyebrow: 'Releases',
      title: 'Protocol-line dist-tags',
      body: 'When an app uses official extensions, lock the same OpenTray protocol-line tag across the package set: pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B. alpha-A-B carries alpha packages on the same protocol line; the tags are published by @opentray/spec.',
      detail: 'stable-A-B · alpha-A-B',
    },
  ];

  // The README workspace table, verbatim rows.
  const workspace = [
    { dir: 'packages/cli', pkg: 'opentray', purpose: 'Developer-facing tray-first SDK and CLI package.' },
    { dir: 'packages/spec', pkg: '@opentray/spec', purpose: 'TypeScript protocol and shared contract package.' },
    { dir: 'packages/packaging', pkg: '@opentray/packaging', purpose: 'Bundler-neutral runtime artifact staging contract.' },
    { dir: 'packages/vite-plugin', pkg: '@opentray/vite-plugin', purpose: 'First Vite adapter over the packaging contract.' },
    { dir: 'packages/ext-webview', pkg: '@opentray/ext-webview', purpose: 'Rich popup extension facade.' },
    { dir: 'packages/ext-webview-*', pkg: '@opentray/ext-webview-*', purpose: 'Platform WebView dynamic library packages.' },
    { dir: 'packages/ext-badge', pkg: '@opentray/ext-badge', purpose: 'Platform badge/progress/overlay API extension.' },
    { dir: 'packages/ext-island', pkg: '@opentray/ext-island', purpose: 'Roadmap dynamic island / live activity extension.' },
    { dir: 'packages/<os>-<arch>', pkg: '@opentray/<os>-<arch>', purpose: 'Platform runtime artifact packages.' },
  ];

  const ecosystem = [
    {
      label: 'GitHub · jixoai/opentray',
      href: GITHUB_URL,
      note: 'Source, issues, and release history.',
    },
    {
      label: 'npm · opentray',
      href: NPM_URL,
      note: 'The developer-facing tray-first SDK and CLI package.',
    },
    {
      label: 'create-app guide',
      href: CREATE_APP_GUIDE_URL,
      note: 'Wrapping an HTTP-serving command with npx create-opentray.',
    },
    {
      label: 'app-mode decision guide',
      href: APP_MODE_GUIDE_URL,
      note: 'Normal apps, tray utilities, and mixed-window products on @opentray/ext-webview.',
    },
    {
      label: 'opentray-ext-lynx',
      href: LYNX_EXT_URL,
      note: 'The Lynx extension, maintained in its own repository.',
    },
  ];
</script>

<svelte:head>
  <title>OpenTray · tray-first desktop status runtime</title>
  <meta
    name="description"
    content="OpenTray is a desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems: a tray-first platform model (App, Tray, Session, Extension) with a Rust core behind a packaged broker executable."
  />
</svelte:head>

<HeroSection
  eyebrow="OpenTray · desktop status runtime"
  summary="A desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems. The platform model is tray-first: one Tray atom per status, one live Session as the authority, optional native Extensions — and createTray() starts the local broker automatically."
  copyCommand="pnpm add opentray"
  copyLabel="copy"
>
  {#snippet title()}
    The <em>tray-first</em> desktop status runtime for Node, Deno, and Bun.
  {/snippet}
  {#snippet badges()}
    <span>Tray-first</span>
    <span>Node · Deno · Bun</span>
    <span>Rust core</span>
    <span>MIT</span>
  {/snippet}
  {#snippet secondary()}
    <PressButton variant="outline" href={GITHUB_URL}>GitHub ↗</PressButton>
  {/snippet}
  {#snippet terminal()}
    <TerminalCard
      barTitle="opentray — first-app"
      command="node first-app.mjs"
      outputs={[
        'tray: com.example.first-app · icon "OT"',
        'menu: Quit (primaryEvent)',
        'broker: started automatically',
        'session: live — events streaming',
      ]}
    />
  {/snippet}
</HeroSection>

<!-- Quick start: the README first-app sample on a readonly-code surface. -->
<div class="mx-auto w-full max-w-[90rem] px-4 pb-4 sm:px-6 lg:px-8" data-reveal="">
  <SectionCard
    eyebrow="Quick start"
    title="Call createTray() for the first app"
    summary="The default runtime starts the local broker automatically. Runtime identity (appId/appName) is separate from tray projection; primaryEvent is a role on a normal menu item and emits the usual menuClick."
  >
    <CodeBlock code={quickStart} lang="ts" meta="first-app.mjs" />
    <p class="text-muted-foreground mt-4 text-[13px] leading-5">
      Already have a command that serves HTTP locally?
      <a href={CREATE_APP_GUIDE_URL} class="text-primary underline underline-offset-2"
        >npx create-opentray</a
      >
      wraps it into an OpenTray-hosted app.
    </p>
  </SectionCard>
</div>

<!-- Features: the platform surface. card-grid owns its children's entrance. -->
<section class="mx-auto w-full max-w-[90rem] px-4 pt-10 sm:px-6 lg:px-8">
  <h2
    class="font-nav flex items-baseline gap-4 text-lg uppercase tracking-[0.3em]"
    data-reveal=""
  >
    What&rsquo;s inside
    <span class="bg-border h-px flex-1" aria-hidden="true"></span>
  </h2>
  <CardGrid class="mt-6" min="340px">
    {#each features as feature (feature.id)}
      <SectionCard
        id={feature.id}
        eyebrow={feature.eyebrow}
        title={feature.title}
        summary={feature.body}
      >
        <p class="text-muted-foreground font-nav text-[11px] uppercase tracking-[0.14em]">
          {feature.detail}
        </p>
      </SectionCard>
    {/each}
  </CardGrid>
</section>

<!-- Workspace package matrix (README table, verbatim rows). -->
<div class="mx-auto w-full max-w-[90rem] px-4 pb-4 pt-12 sm:px-6 lg:px-8" data-reveal="">
  <SectionCard
    eyebrow="Workspace"
    title="One repository, one package family"
    summary="The npm surface mirrors the repository layout. The Lynx extension is maintained in the independent jixoai/opentray-ext-lynx repository; OpenTray core does not build, stage, or publish Lynx artifacts."
  >
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Directory</th>
            <th>npm package</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {#each workspace as row (row.pkg)}
            <tr>
              <td class="dim">{row.dir}</td>
              <td><code>{row.pkg}</code></td>
              <td>{row.purpose}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </SectionCard>
</div>

<!-- Ecosystem links close the narrative before the footer ghost. -->
<div class="mx-auto w-full max-w-[90rem] px-4 pb-4 pt-12 sm:px-6 lg:px-8" data-reveal="">
  <SectionCard
    eyebrow="Ecosystem"
    title="Where things live"
    summary="Source, packages, and the public guides — the same links the README carries."
  >
    <ul class="flex flex-col gap-3">
      {#each ecosystem as link (link.href)}
        <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 pb-3">
          <a
            href={link.href}
            class="text-primary font-nav text-[13px] uppercase tracking-[0.1em] underline underline-offset-2"
          >
            {link.label} ↗
          </a>
          <span class="text-muted-foreground text-[13px] leading-5">{link.note}</span>
        </li>
      {/each}
    </ul>
  </SectionCard>
</div>
