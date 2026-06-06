## 1. OpenSpec Law

- [x] 1.1 Record the user requirement that protocol-line tags must be OpenTray-wide and extension-agnostic.
- [x] 1.2 Record the release auth boundary that trusted publishing OIDC covers publish/stage publish, not arbitrary dist-tag mutation.
- [x] 1.3 Validate the OpenSpec change after implementation.

## 2. Public Protocol Spec

- [x] 2.1 Add `@opentray/spec` protocol-line constants for `opentray-protocol/1.0`.
- [x] 2.2 Add formatter/parser helpers for `stable-1-0` and `alpha-1-0` style npm dist-tags.
- [x] 2.3 Add tests proving extension names are rejected and runtime `PROTOCOL_VERSION` remains separate from the install-time tag.

## 3. Release Tooling

- [x] 3.1 Add a dry-run-first npm protocol dist-tag planner script.
- [x] 3.2 Add tests proving the planner tags every public workspace package with the same extension-agnostic protocol-line selector.
- [x] 3.3 Add package scripts for maintainers to review or apply the protocol-line tag plan.

## 4. Skills / Docs

- [x] 4.1 Update internal OpenTray release skill guidance with the protocol-line tag law.
- [x] 4.2 Update extension developer guidance so official extensions use the same OpenTray protocol-line tag as core.
- [x] 4.3 Update external `opentray` user skill with `latest` vs `stable-1-0` / `alpha-1-0` install guidance.

## 5. Verification

- [x] 5.1 Run `pnpm --filter @opentray/spec test`.
- [x] 5.2 Run targeted npm script tests.
- [x] 5.3 Run `bun run openspec:vision -- validate define-opentray-protocol-line-dist-tags`.
- [x] 5.4 Run `bun run openspec:vision -- check define-opentray-protocol-line-dist-tags`.
- [x] 5.5 Run `git diff --check`.
