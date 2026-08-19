# Intent Document

## Current Round

- Round: 1
- Status: implementation pending
- Created: 2026-07-17

## Original User Input

> ??? 'pnpm pub start' ???????? 'pnpx pnpm-pub@latest start' ??????????????

## Objective

Make Windows WebView2 startup independent from the filesystem depth of the broker executable.

## Evidence

| Observation | Meaning |
| --- | --- |
| Local 'pnpm pub start' succeeds | The application protocol and tray bootstrap are valid. |
| 'pnpx pnpm-pub@latest start' creates a tray icon, then disappears | The broker starts; failure occurs during retained WebView creation. |
| Wry 0.55.1 defaults to an executable-relative WebView2 data directory | A temporary 'pnpx' install path can make WebView2 profile initialization fail with '0x80080005'. |
| 'WebContext::new(Some(path))' is available | The native host can own a stable, explicit profile location. |

## Architecture

    CLI daemon environment
      OPENTRAY_WEBVIEW_DATA_DIR (optional override)
                  |
                  v
        resolve stable profile root
                  |
                  +-- ~/.opentray/webview/<package-version>/<caller-label>
                  |
                  v
           WebContext owns profile
                  |
                  v
           WebView2 child owns page

## Durable Invariants

1. The WebView2 profile path SHALL NOT be derived from the broker executable path.
2. The default path SHALL be short, user-writable, and isolated by OpenTray package version and caller label.
3. 'OPENTRAY_WEBVIEW_DATA_DIR' SHALL override the computed default for diagnostics and deployment-specific storage.
4. The 'WebContext' SHALL outlive the 'WebView' that uses it.
5. Creation errors SHALL expose the resolved profile path.

## Scope

- Windows WebView host only.
- No pnpm-pub-specific launcher workaround.
- No changes to WebView transparency, native material, tray visibility, or broker transport.
- No test-suite execution in this round; non-test compilation/build verification is sufficient for delivery.

## Intent-Driven Plan

- [x] Record the failure evidence and profile-path invariant.
- [ ] Implement explicit WebView2 profile ownership in the Windows host.
- [ ] Update project laws and vocabulary.
- [ ] Build the Windows runtime and extension artifacts.
- [ ] Prepare OpenTray and pnpm-pub release versions.

## Risks

- Existing processes using an old executable-relative profile may keep that directory locked; a fresh process with the explicit path must be used for acceptance.
- Different OpenTray versions intentionally use separate profiles, so browser cache/cookies are not shared across version directories.
