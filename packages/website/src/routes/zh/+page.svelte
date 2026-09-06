<!--
  Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
  Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页):
  1. `/zh/` is the Chinese mirror of the home page: same renderer, zh copy
     from README-zh.md (home-content.ts); English stays at `/` with stable
     URLs, so this route is a thin locale selector only.
-->
<script lang="ts">
  import HomePage from '$lib/components/home-page.svelte';
</script>

<HomePage locale="zh" />
