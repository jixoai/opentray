# Self Review

## Verdict

The patched `opentray` SDK now exposes the top-level broker-backed entrypoints that the README and `client-sdk` spec already promised.

This is the correct fix boundary:

- `packages/cli/src/sdk.ts` adds the missing convenience facade
- `packages/cli/src/client.ts` adds explicit default-space resolution
- the implementation composes existing atoms (`connectLocalBroker` + `createClient`)
- no Rust broker, daemon protocol, or extension-host law was changed for a JavaScript export-surface bug

This change is ready to ship as a patch release once the OpenSpec check passes and the patched npm version is verified from a fresh install.

## Trace

| Intent / spec point | Implementation evidence | Verdict |
| ------------------- | ----------------------- | ------- |
| `opentray` top-level exports must include `createSpace` for ordinary SDK consumers. | `packages/cli/src/index.ts` re-exports `createSpace`; `packages/cli/src/sdk.ts` connects through `connectLocalBroker` and `createClient(connection).createSpace(...)`. | Pass |
| `createSurface` may remain only as a deprecated compatibility alias. | `packages/cli/src/sdk.ts` implements `createSurface` as a wrapper over `createSpace`; docs mark it deprecated. | Pass |
| The public SDK should expose observable default-space resolution rather than hiding it as internal protocol detail. | `packages/cli/src/client.ts` adds `resolveDefaultSpace()` on `OpenTrayClient`; `packages/cli/src/sdk.ts` re-exports a top-level `resolveDefaultSpace()`. | Pass |
| Top-level `createTray` should resolve the broker default space when no explicit target is provided. | `packages/cli/src/sdk.ts` branches on `brokerOptions.space`: explicit space uses `createSpaceHandle`, otherwise it calls `createClient(connection).resolveDefaultSpace()` before creating the tray. | Pass |
| The repair should stay in TypeScript facade composition and not duplicate daemon lifecycle logic. | `connectLocalBroker` remains the only same-version daemon auto-start path used by the new top-level APIs. | Pass |
| Public docs must match the real package surface. | `packages/cli/README.md` and root `README.md` now show top-level `createSpace`, `resolveDefaultSpace`, and `createTray`. | Pass |

## Verification Evidence

- `pnpm --filter opentray test` passed.
- `pnpm run verify` passed after adding Node typings to `packages/ext-webview/tsconfig.json`.
- `node --input-type=module -e "const m=await import('./packages/cli/dist/index.mjs'); console.log(JSON.stringify(Object.keys(m).sort()));"` reported top-level exports including `createSpace`, `createSurface`, `createTray`, and `resolveDefaultSpace`.
- `pnpm exec changeset status --verbose` reports a patch release plan for `opentray` and the platform binary packages at `0.3.1`.
- `bun run openspec:vision -- status fix-sdk-top-level-space-api` now only required self-review before this artifact was added.

## Residual Risks

- Fresh npm install acceptance still depends on publishing the patch release. The working tree is correct, but registry parity is not proven until `0.3.1` is live.
- The public facade now depends on Node-typed runtime imports being visible during monorepo verification; `packages/ext-webview/tsconfig.json` explicitly opts into Node typings to keep that proof green.

## Archive Decision

- `bun run openspec:vision -- check fix-sdk-top-level-space-api` should pass after this review is present.
- Normal exit for this turn: commit the repair, push, publish `0.3.1`, and run fresh npm install acceptance against the published package.
- No abnormal handoff is needed in the current working context.
