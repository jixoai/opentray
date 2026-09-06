<!--
  Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
  Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页;
  extended 2026-09-06: 官网文案要升级——目的先行，可溯源到意图信源):
  1. One home-page renderer for both locales: markup is locale-invariant,
     copy comes from home-content.ts (purpose-led, sourced from the repo's
     intent documents — README pair, AGENTS.md Vision, SPEC.md), so / and
     /zh/ stay isomorphic by construction.
  2. Per-locale head: <title>/<description> plus hreflang alternates
     (en / zh / x-default) with absolute URLs from the canonical SITE_URL —
     the same origin the llms.txt export layer treats as truth.
  3. Motion law (inherited from the one-page narrative): the hero owns its
     cascade, card-grid owns its children's entrance (cards never carry
     data-reveal); other sections ride the theme's scroll-driven
     [data-reveal] hooks.
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
    SITE_URL,
  } from '$lib/constants';
  import { homeContent, quickStartCode, type Locale } from '$lib/home-content';

  interface Props {
    locale: Locale;
  }

  let { locale }: Props = $props();

  const content = $derived(homeContent[locale]);
  const { hero, quickStart, workspace } = $derived(content);

  // hreflang alternates: en is the x-default (stable root URLs law).
  const alternates = [
    { rel: 'alternate', hreflang: 'en', href: `${SITE_URL}/` },
    { rel: 'alternate', hreflang: 'zh', href: `${SITE_URL}/zh/` },
    { rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}/` },
  ];

  // Ecosystem link targets are locale-invariant README facts; labels/notes
  // come from the content dictionary.
  const ecosystem = $derived(
    content.ecosystem.links.map((link, index) => ({
      ...link,
      href: [GITHUB_URL, NPM_URL, CREATE_APP_GUIDE_URL, APP_MODE_GUIDE_URL, LYNX_EXT_URL][index],
    })),
  );
</script>

<svelte:head>
  <title>{content.meta.title}</title>
  <meta name="description" content={content.meta.description} />
  {#each alternates as alternate (alternate.hreflang)}
    <link rel={alternate.rel} hreflang={alternate.hreflang} href={alternate.href} />
  {/each}
</svelte:head>

<HeroSection
  eyebrow={hero.eyebrow}
  summary={hero.summary}
  copyCommand="pnpm add opentray"
  copyLabel={hero.copyLabel}
>
  {#snippet title()}
    {hero.titlePre}<em>{hero.titleEm}</em>{hero.titlePost}
  {/snippet}
  {#snippet badges()}
    {#each hero.badges as badge (badge)}
      <span>{badge}</span>
    {/each}
  {/snippet}
  {#snippet secondary()}
    <PressButton variant="outline" href={GITHUB_URL}>{hero.secondaryLabel}</PressButton>
  {/snippet}
  {#snippet terminal()}
    <TerminalCard
      barTitle={hero.terminal.barTitle}
      command={hero.terminal.command}
      outputs={hero.terminal.outputs}
    />
  {/snippet}
</HeroSection>

<!-- Quick start: the README first-app sample on a readonly-code surface. -->
<div class="mx-auto w-full max-w-[90rem] px-4 pb-4 sm:px-6 lg:px-8" data-reveal="">
  <SectionCard eyebrow={quickStart.eyebrow} title={quickStart.title} summary={quickStart.summary}>
    <CodeBlock code={quickStartCode} lang="ts" meta="first-app.mjs" />
    <p class="text-muted-foreground mt-4 text-[13px] leading-5">
      {quickStart.notePre}
      <a href={CREATE_APP_GUIDE_URL} class="text-primary underline underline-offset-2"
        >{quickStart.noteLink}</a
      >
      {quickStart.notePost}
    </p>
  </SectionCard>
</div>

<!-- Features: the platform surface. card-grid owns its children's entrance. -->
<section class="mx-auto w-full max-w-[90rem] px-4 pt-10 sm:px-6 lg:px-8">
  <h2
    class="font-nav flex items-baseline gap-4 text-lg uppercase tracking-[0.3em]"
    data-reveal=""
  >
    {content.featuresHeading}
    <span class="bg-border h-px flex-1" aria-hidden="true"></span>
  </h2>
  <CardGrid class="mt-6" min="340px">
    {#each content.features as feature (feature.id)}
      <SectionCard id={feature.id} eyebrow={feature.eyebrow} title={feature.title} summary={feature.body}>
        <p class="text-muted-foreground font-nav text-[11px] uppercase tracking-[0.14em]">
          {feature.detail}
        </p>
      </SectionCard>
    {/each}
  </CardGrid>
</section>

<!-- Workspace package matrix (README table, verbatim rows). -->
<div class="mx-auto w-full max-w-[90rem] px-4 pb-4 pt-12 sm:px-6 lg:px-8" data-reveal="">
  <SectionCard eyebrow={workspace.eyebrow} title={workspace.title} summary={workspace.summary}>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>{workspace.headers[0]}</th>
            <th>{workspace.headers[1]}</th>
            <th>{workspace.headers[2]}</th>
          </tr>
        </thead>
        <tbody>
          {#each workspace.rows as row (row.pkg)}
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
    eyebrow={content.ecosystem.eyebrow}
    title={content.ecosystem.title}
    summary={content.ecosystem.summary}
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
