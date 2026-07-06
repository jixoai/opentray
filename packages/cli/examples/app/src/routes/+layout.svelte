<script lang="ts">
  // The root layout intentionally renders ONLY the global stylesheet and the
  // route content. Each example route owns its entire window surface and must
  // not inherit any chrome (sidebar, header, padding) from here — examples are
  // mutually isolated at runtime even though they share the component library
  // and build pipeline. The index page at `/` provides cross-example navigation.
  import "../app.css";
  let { children } = $props();
</script>

{@render children()}
