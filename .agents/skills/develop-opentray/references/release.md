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

Changesets must only bump peer dependents when their peer dependency range is out of range. Keep `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange` enabled so roadmap extension placeholders do not get stable releases from an `opentray` peer bump alone.

## Alpha Channel Rule

When the user wants `npm i opentray@alpha`, treat that as a real release path, not a casual `--tag alpha` afterthought.

- The alpha path must not consume the later stable version numbers.
- Prefer changesets snapshot or prerelease versioning plus `changeset publish --tag alpha`.
- Keep stable `main` releases on the normal path.
- Published docs and skills must say what is actually alpha versus stable.

If the current branch only proves macOS visually while Windows/Linux still expose package topology or typed unsupported runtime paths, the alpha channel is the more honest public surface.

## Changeset-Gated Preview Build Rule

Branch preview builds are not the same thing as the release workflow.

- Automatic preview builds should start only when a push updates `.changeset/*.md`.
- A changed changeset still does not spend heavy build resources unless it contains an OpenTray preview marker.
- The marker is the operator-controlled build intent surface; changing its `alias` is the normal way to request a fresh preview build after several ordinary code commits.

Recommended minimal marker:

```md
<!-- opentray-preview {"alias":"webview-20260605-1"} -->
```

Recommended explicit marker when the operator wants to override the inferred family or default target:

```md
<!-- opentray-preview {"alias":"webview-20260605-2","families":["ext-webview-native"],"targets":["darwin-arm64"]} -->
```

Planner law:

- infer families from the changeset release packages when `families` is omitted
- use the family default targets when `targets` is omitted
- fail explicitly if one push changes multiple changesets that all request preview builds

The first branch-preview priority is `ext-webview-native` isolation: WebView preview builds may compile the broker binary they need for testing, but they must not compile `opentray-ext-lynx` or build the Lynx runtime sidecar unless the preview request explicitly asks for a Lynx family.

## Publish Artifact Rule

`opentray`, `@opentray/spec`, and `@opentray/ext-webview` publish from `dist`. The release workflow must run `pnpm run build` before `changeset publish`.

## Native Artifact CI Rule

Release-grade daemon binaries and native extension dynamic libraries must be built in GitHub Actions. Local `target/release` outputs are smoke evidence only and must not be used as npm publish inputs.

The release workflow should use maintained Actions for Rust setup/cache and artifact transport:

- `dtolnay/rust-toolchain@stable` plus `Swatinem/rust-cache@v2`, or an equivalent maintained setup/cache Action.
- `actions/upload-artifact` and `actions/download-artifact` for passing native outputs into the npm publish job.

Do not make Tauri app build Actions, GitHub Release binary upload Actions, or default `cross` builds the main OpenTray release path. OpenTray publishes npm platform packages, and WebView GUI artifacts should expose native runner dependency problems instead of hiding them behind cross-compilation.

Release planning is now package-truth-driven rather than platform-matrix-first:

- preview and release share the same native build graph
- the lowest-level native atoms are `daemon`, `webview`, `lynx`, and `lynx-runtime`
- release reads pending changesets, infers which native atoms are actually part of this publish, and only builds those atoms on their supported targets
- a WebView-only alpha or stable publish must not compile `opentray-ext-lynx` or build `LynxExplorer.app.zip`
- a Lynx publish still includes both the darwin dylib and the darwin runtime zip, because those are separate atoms in the Lynx family rather than an accidental side effect of all macOS releases

## Provenance Metadata Rule

Every public package manifest must include repository metadata with `url: "https://github.com/jixoai/opentray"`. npm trusted publishing rejects signed provenance when package metadata omits or mismatches the GitHub repository URL.

## Version Commit Rule

The GitHub organization does not allow Actions to create pull requests. The release workflow must not depend on changesets/action release-PR creation. When pending `.changeset/*.md` files exist, the workflow versions packages, commits the generated changes directly to `main`, and continues to publish in the same run because `GITHUB_TOKEN` pushes do not recursively trigger a follow-up workflow run.

## Verification Before Claiming Release Ready

```bash
pnpm run build
pnpm run verify
openspec validate --all --strict
git diff --check
```

For alpha publishes, add a fresh-install check that uses the alpha channel entrypoint and records that evidence separately from stable release evidence:

```bash
npm i opentray@alpha
```
