# Tasks

- [x] 1. Confirm the plan matches the current preview-only family-build implementation and the still-hard-coded release native matrix.
- [x] 2. Update the shared build and release specs.
- [x] 3. Refactor `scripts/binaries/*` so preview and release planning share one authoritative native build graph for targets, artifact kinds, and atom composition.
- [x] 4. Add a release planner that derives native jobs, staged package dirs, and validation scope from pending changesets package truth.
- [x] 5. Update `.github/workflows/release.yml` so native-artifacts and staging/validation steps follow planner outputs instead of the fixed full-platform family matrix.
- [x] 6. Keep preview-native behavior working on top of the same shared graph without reintroducing Lynx coupling into WebView preview builds.
- [x] 7. Add or update BDD tests for the shared graph, release planner, preview planner, and release workflow text assertions.
- [x] 8. Update release/operator guidance that currently implies release always builds every native family.
- [x] 9. Run focused verification for scripts and workflow tests, then run the smallest repo gate needed to prove the change.
