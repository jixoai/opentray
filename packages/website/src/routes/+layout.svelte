<!--
  Orthogonal intents (maintained 2026-09-06; original user request: 新增
  ./opentray 官网站点):
  1. Site shell: the registry website-scaffold wrapping every page — sticky
     TerminalHeader band, main column, TerminalFooter ghost wordmark.
  2. Base-path law: every internal link resolves through $app/paths `base`
     (SITE_BASE feeds kit.paths.base); nothing hardcodes a prefix.
  3. Scrollbar law hook: <jx-scrollbar-measure> registers once here so the
     per-OS scrollbar widths feed the padding-compensation tokens.
-->
<script lang="ts">
  import '$lib/scrollbar-measure';
  import '../app.css';
  import { base } from '$app/paths';
  import WebsiteScaffold from '$lib/ui/website-scaffold/website-scaffold.svelte';
  import TerminalHeader from '$lib/ui/terminal-header/terminal-header.svelte';
  import TerminalFooter from '$lib/ui/terminal-footer/terminal-footer.svelte';
  import TerminalFooterColumn from '$lib/ui/terminal-footer/terminal-footer-column.svelte';
  import NavigationMenu from '$lib/ui/navigation-menu/navigation-menu.svelte';
  import NavigationMenuLink from '$lib/ui/navigation-menu/navigation-menu-link.svelte';
  import ThemeToggle from '$lib/ui/theme-toggle/theme-toggle.svelte';
  import {
    APP_MODE_GUIDE_URL,
    CREATE_APP_GUIDE_URL,
    GITHUB_URL,
    LYNX_EXT_URL,
    NPM_URL,
    SITE_DOMAIN,
    SITE_SUBTITLE,
  } from '$lib/constants';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const homeHref = base === '' ? '/' : `${base}/`;
</script>

<WebsiteScaffold>
  {#snippet header()}
    <TerminalHeader
      brand="OpenTray"
      domain={SITE_DOMAIN}
      subtitle={SITE_SUBTITLE}
      {homeHref}
    >
      {#snippet logo()}
        <img
          src={`${base}/opentray-logo.png`}
          alt=""
          class="h-6 w-6 object-contain"
          loading="eager"
          decoding="async"
        />
      {/snippet}
      {#snippet switcher()}
        <ThemeToggle variant="compact" />
      {/snippet}
      {#snippet drawer()}
        <div class="flex flex-col items-stretch gap-1 py-2">
          <NavigationMenuLink href={homeHref} current>Overview</NavigationMenuLink>
          <NavigationMenuLink href={GITHUB_URL}>GitHub ↗</NavigationMenuLink>
          <NavigationMenuLink href={NPM_URL}>npm ↗</NavigationMenuLink>
        </div>
      {/snippet}
      <NavigationMenu label="site">
        <NavigationMenuLink href={homeHref} current>Overview</NavigationMenuLink>
        <NavigationMenuLink href={GITHUB_URL}>GitHub ↗</NavigationMenuLink>
        <NavigationMenuLink href={NPM_URL}>npm ↗</NavigationMenuLink>
      </NavigationMenu>
    </TerminalHeader>
  {/snippet}

  {@render children()}

  {#snippet footer()}
    <TerminalFooter ghost="OPENTRAY" copyright="Copyright © 2026 OpenTray contributors · MIT">
      <TerminalFooterColumn title="project">
        <a href={GITHUB_URL}>GitHub ↗</a>
        <a href={NPM_URL}>npm · opentray ↗</a>
      </TerminalFooterColumn>
      <TerminalFooterColumn title="guides">
        <a href={CREATE_APP_GUIDE_URL}>create-app guide ↗</a>
        <a href={APP_MODE_GUIDE_URL}>app-mode guide ↗</a>
      </TerminalFooterColumn>
      <TerminalFooterColumn title="ecosystem">
        <a href={LYNX_EXT_URL}>opentray-ext-lynx ↗</a>
      </TerminalFooterColumn>
    </TerminalFooter>
  {/snippet}
</WebsiteScaffold>
