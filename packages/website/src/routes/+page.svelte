<!--
  Orthogonal intents (maintained 2026-09-06; original user request: 新增
  ./opentray 官网站点，内容一律取自 README 定位、不得虚构; extended
  2026-09-06: 所有站点需要至少提供中英两种语言的支持):
  1. `/` stays the English home (stable inbound URLs); all copy and markup
     live in the shared renderer + content dictionary, so this route is a
     thin locale selector only.
-->
<script lang="ts">
  import HomePage from '$lib/components/home-page.svelte';
</script>

<HomePage locale="en" />
