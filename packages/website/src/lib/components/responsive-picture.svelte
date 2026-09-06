<!--
  ResponsivePicture (src/lib/components/responsive-picture.svelte)

  Single renderer for vite-imagetools `?…&as=picture` imports (Owner
  image-optimization law, 2026-09-07). The import's contract: `sources`
  maps format → srcset string (width descriptors, e.g. webp), `img`
  carries the fallback entry (largest size of the LAST requested format)
  with `src`/`w`/`h`. Here: every non-fallback format becomes a
  <source> candidate, the img keeps its own format's srcset plus
  intrinsic w/h (no layout shift). alt/class come from the caller —
  decorative logos pass alt="".
-->
<script lang="ts">
  export interface PictureSet {
    img: { src: string; w: number; h: number };
    sources: Record<string, string>;
  }

  let {
    set,
    alt = '',
    class: klass = '',
    eager = false,
  }: { set: PictureSet; alt?: string; class?: string; eager?: boolean } = $props();

  /** format of the fallback entry (extension of img.src, e.g. "png") */
  const fallbackFormat = $derived(set.img.src.match(/\.([a-z]+)$/)?.[1] ?? '');
</script>

<picture>
  {#each Object.entries(set.sources) as [format, srcset] (format)}
    {#if format !== fallbackFormat}
      <source type={`image/${format}`} {srcset} />
    {/if}
  {/each}
  <img
    src={set.img.src}
    srcset={set.sources[fallbackFormat]}
    width={set.img.w}
    height={set.img.h}
    {alt}
    class={klass}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
  />
</picture>
