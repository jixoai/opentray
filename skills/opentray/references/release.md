# Release

Use this reference when changing changesets, npm trusted publishing, release workflows, package manifests, or release readiness.

## Trusted Publishing Claims

OpenTray's npm trusted publisher configuration must match:

- Provider: GitHub Actions.
- Repository: `jixoai/opentray`.
- Workflow file: `release.yml`.
- Environment: `npm-release`.
- Allowed actions: `npm publish` and `npm stage publish`.

The GitHub workflow must have `id-token: write` and must not depend on a long-lived `NPM_TOKEN` for CI publish.

## Local Commands

```bash
pnpm run trusted-publish:dry-run
pnpm run trusted-publish:check
pnpm run trusted-publish:configure
pnpm run changeset
pnpm run build
pnpm run verify
```

`NPM_TOKEN` may exist in local `.env` only for operator-side trusted publisher management. Do not commit `.env`.

## Known npm Auth Boundary

Tokens created with bypass-2FA may authenticate package access but fail trusted-publisher management with `E403`. Ambient npm login may require OTP and can fail with `EOTP`. Treat this as external auth state, not repository code failure.

## Changeset Rule

Release-worthy package API/runtime changes must include a `.changeset/*.md` note for affected npm packages. Do not bump placeholder packages just because docs mention them.

## Publish Artifact Rule

`opentray`, `@opentray/spec`, and `@opentray/ext-webview` publish from `dist`. The release workflow must run `pnpm run build` before `changeset publish`.

## Verification Before Claiming Release Ready

```bash
pnpm run build
pnpm run verify
openspec validate --all --strict
git diff --check
```
