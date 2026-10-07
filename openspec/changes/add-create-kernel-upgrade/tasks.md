# add-create-kernel-upgrade — Tasks

## 1. Alignment

- [x] 1.1 plan.md records D1–D6 (kernel definition, stop-before-upgrade, node_modules
      version truth, one-core-two-vectors, bounded failure surfaces, upgrade ≠ reinstall).

## 2. Core

- [ ] 2.1 `kernel-upgrade.ts`: `upgradeAppKernel(projectDir, { target?, restart?, runner
      seams })` — dependency discovery, stop-before-upgrade via `stopLiveAppInstances`,
      package-manager install, from/to version truth from node_modules, bounded output
      tail on failure, optional restart through `openMaterializedApp` with observation.
- [ ] 2.2 `kernel-upgrade.test.ts`: stop ran before install; version truth; already
      up-to-date; install-failure detail carries the output tail; restart folds the
      first-start observation.

## 3. CLI

- [ ] 3.1 `app upgrade <app-id>` / `--all` / `--target <spec>` / `--restart` / `--json`
      wired into the yargs `app` tree; `--all` fans out over registrations sequentially.
- [ ] 3.2 Command tests (fake core seams): flag wiring, batch fan-out, JSON shape.

## 4. WebUI

- [ ] 4.1 `POST /api/apps/:key/upgrade` endpoint (workbench-api) delegating to core with
      observation on restart.
- [ ] 4.2 applications page: per-row select checkboxes + select-all, "Upgrade kernel"
      action over the selection, sequential per-app results rendered in the result panel.
- [ ] 4.3 i18n keys across every locale (en/zh-cn/de/es/fr/ja/ko/ru/ar).

## 5. Verification

- [ ] 5.1 Focused suites green (core / create / create-webui + typecheck).
- [ ] 5.2 Real-machine acceptance: CLI upgrades the local `remote-ai-z-zcode` project to
      the newly published version; `node_modules` versions advanced; app reopens.
- [ ] 5.3 Vision walkthrough of the webui applications upgrade surface.
- [ ] 5.4 Changesets + release.
