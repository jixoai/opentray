<!--
  Orthogonal intents (maintained 2026-09-06; original user request: 新增
  ./opentray 官网站点): readonly code surface (muted background, hairline
  border, optional meta strip in accent tints); token colors come from the
  theme sheet, so one markup serves both light and dark themes.
-->
<script lang="ts">
  import { highlight } from '$lib/highlight';

  interface Props {
    code: string;
    lang?: string;
    meta?: string;
  }

  let { code, lang = 'ts', meta = '' }: Props = $props();

  const html = $derived(highlight(code, lang));
</script>

<figure class="readonly-code">
  {#if meta}
    <figcaption class="readonly-code-meta">
      <span class="prompt" aria-hidden="true">&gt;</span>
      <span>{meta}</span>
    </figcaption>
  {/if}
  <pre data-lang={lang}><code>{@html html}</code></pre>
</figure>
