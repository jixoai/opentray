<!--
  Orthogonal intents (maintained 2026-09-06; original user request: 新增
  ./opentray 官网站点; extended 2026-09-06: 所有站点需要至少提供中英两种
  语言的支持):
  1. Site shell: the registry website-scaffold wrapping every page — sticky
     TerminalHeader band, main column, TerminalFooter ghost wordmark.
  2. Base-path law: every internal link resolves through $app/paths `base`
     (SITE_BASE feeds kit.paths.base); nothing hardcodes a prefix.
  3. Scrollbar law hook: <jx-scrollbar-measure> registers once here so the
     per-OS scrollbar widths feed the padding-compensation tokens.
  4. Locale surface: the header carries the registry language-switcher
     beside the theme toggle (switcherFrame off — both controls are
     self-framed, the openspecui bilingual-site composition); switcher
     hrefs keep the current hash so anchor position survives the locale
     hop, and the Overview entry + brand link stay on the current locale.
     Locale persistence lives IN the switcher (consumer-feedback-fixes
     P0-2): its click handler writes localStorage `lang` — the key the
     app.html pre-paint negotiation reads as the WINNING choice.
-->
<script lang="ts">
  import '$lib/scrollbar-measure';
  import '../app.css';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import WebsiteScaffold from '$lib/ui/website-scaffold/website-scaffold.svelte';
  import TerminalHeader from '$lib/ui/terminal-header/terminal-header.svelte';
  import TerminalFooter from '$lib/ui/terminal-footer/terminal-footer.svelte';
  import TerminalFooterColumn from '$lib/ui/terminal-footer/terminal-footer-column.svelte';
  import NavigationMenu from '$lib/ui/navigation-menu/navigation-menu.svelte';
  import NavigationMenuLink from '$lib/ui/navigation-menu/navigation-menu-link.svelte';
  import ThemeToggle from '$lib/ui/theme-toggle/theme-toggle.svelte';
  import LanguageSwitcher from '$lib/ui/language-switcher/language-switcher.svelte';
  import {
    APP_MODE_GUIDE_URL,
    CREATE_APP_GUIDE_URL,
    GITHUB_URL,
    LYNX_EXT_URL,
    NPM_URL,
    SITE_DOMAIN,
    SITE_SUBTITLE,
  } from '$lib/constants';
  import { homeContent } from '$lib/home-content';
  import { pathnameLocale } from '$lib/locale';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // Locale via the shared pathname law ($lib/locale): `page.url.pathname`
  // is always the absolute path (base included), so detection works under
  // any SITE_BASE in dev, hydration, and prerender alike — `$app/paths`
  // `base` cannot be used to strip it (prerender serves it page-relative).
  const locale = $derived(pathnameLocale(page.url.pathname));
  const chrome = $derived(homeContent[locale].chrome);

  // Client-side locale hops never re-run the server hook that fills the
  // %lang% placeholder in app.html, so the hydrated app syncs <html lang>
  // itself ($effect never runs during SSR — prerendered pages ship the
  // server-resolved lang).
  $effect(() => {
    document.documentElement.lang = locale;
  });

  // Base-path law: the brand link and the Overview entry stay on the
  // CURRENT locale; the root stays '/' in root builds.
  const enHref = base === '' ? '/' : `${base}/`;
  const homeHref = $derived(locale === 'zh' ? `${base}/zh/` : enHref);

  // Language switcher: plain anchors (SSG-safe); the live hash rides the
  // hrefs so switching preserves the current anchor (empty at prerender).
  const hash = $derived(page.url.hash);
  const switcherLocales = $derived([
    { code: 'en', label: 'EN', href: `${enHref}${hash}` },
    { code: 'zh', label: '中文', href: `${base}/zh/${hash}` },
  ]);
</script>

<WebsiteScaffold>
  {#snippet header()}
    <TerminalHeader
      brand="OpenTray"
      domain={SITE_DOMAIN}
      subtitle={SITE_SUBTITLE}
      {homeHref}
      switcherFrame={false}
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
        <div class="flex items-center gap-2">
          <LanguageSwitcher
            variant="pair"
            locales={switcherLocales}
            current={locale}
            ariaLabel={chrome.switcherAriaLabel}
          />
          <ThemeToggle variant="compact" />
        </div>
      {/snippet}
      {#snippet drawer()}
        <div class="flex flex-col items-stretch gap-1 py-2">
          <NavigationMenuLink href={homeHref} current>{chrome.overviewLabel}</NavigationMenuLink>
          <NavigationMenuLink href={GITHUB_URL}>GitHub ↗</NavigationMenuLink>
          <NavigationMenuLink href={NPM_URL}>npm ↗</NavigationMenuLink>
        </div>
      {/snippet}
      <NavigationMenu label="site">
        <NavigationMenuLink href={homeHref} current>{chrome.overviewLabel}</NavigationMenuLink>
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
