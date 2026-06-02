# Tasks

- [ ] 1. Lock OpenSpec intent for the published SDK gap.
- [ ] 1.1 Write `plans/plan.md` with fresh npm install evidence showing the missing top-level exports.
- [ ] 1.2 Add `client-sdk` spec deltas for top-level `createSpace` / `createTray` / default-space resolution.
- [ ] 1.3 Run `bun run openspec:vision -- validate fix-sdk-top-level-space-api`.
- [ ] 1.4 Run `bun run openspec:vision -- commit-check fix-sdk-top-level-space-api --phase research-plan`.

- [ ] 2. Implement the public SDK facade fix.
- [ ] 2.1 Extend the TypeScript client layer with explicit default-space resolution support.
- [ ] 2.2 Add top-level `createSpace`, deprecated `createSurface`, and broker-backed `createTray` exports in `opentray`.
- [ ] 2.3 Keep the implementation as composition of existing atoms: `connectLocalBroker` + `createClient`; do not duplicate daemon lifecycle logic.
- [ ] 2.4 Add or update tests for public exports, default-space resolution, and alias behavior.
- [ ] 2.5 Update `packages/cli/README.md` and any root README examples that describe the public SDK surface.
- [ ] 2.6 Add a changeset for the public package release.

- [ ] 3. Prove the repaired public surface.
- [ ] 3.1 Run the narrow package gates for `opentray`.
- [ ] 3.2 Run repository verification if the package-level proof is green.
- [ ] 3.3 Pack or install the built package and confirm the top-level exports now include `createSpace` and `createTray`.

- [ ] 4. Self-review and close the repair loop.
- [ ] 4.1 Write self-review evidence for the repaired SDK surface.
- [ ] 4.2 Run `bun run openspec:vision -- check fix-sdk-top-level-space-api`.
- [ ] 4.3 Decide whether the change can ship as a patch release to complete the active goal.
