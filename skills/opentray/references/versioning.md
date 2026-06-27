# Versioning

Use this reference when the user asks what OpenTray version to install or when official extensions must stay compatible with `opentray`.

## Install Law

`latest` means the newest published package version. It is useful for quick exploration, but it is not a compatibility contract across `opentray`, official extensions, and native package atoms.

OpenTray publishes public packages as one package line. After a stable release, `opentray`, `@opentray/spec`, official extension facades, native platform atoms, and bundler adapters should share the same package version. If those versions drift on npm, treat the registry state as release drift and check the release manifest, package manifests, and dist-tags before changing application code.

Protocol-line dist-tags describe a compatible package closure:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

Use `alpha-A-B` for alpha packages on the same protocol line:

```bash
pnpm add opentray@alpha-A-B @opentray/ext-webview@alpha-A-B
```

Replace `A-B` with the current protocol-line dist-tag published from `@opentray/spec`. Use the same tag for `opentray` and official extensions in the same app.

## Rules

- Do not mix `opentray@latest` with `@opentray/ext-webview@stable-A-B` unless debugging package drift.
- Do not invent extension-specific tags such as `stable-webview-A-B`; the protocol line is OpenTray-wide.
- Do not ask users to install platform runtime packages directly. `opentray` and official extension facades resolve supported native packages through optional dependencies.
- Do not recommend mixed package versions inside one OpenTray app. Use the aligned package version or one shared protocol-line tag across the package set.
- Treat generated release manifests, package manifests, and npm dist-tags as release truth. Local install symptoms are projections and should be checked against those sources.

## Checks

When debugging installation drift, inspect the published tags before changing code:

```bash
pnpm view opentray dist-tags
pnpm view @opentray/ext-webview dist-tags
```
