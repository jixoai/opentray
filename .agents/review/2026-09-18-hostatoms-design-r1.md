# OpenTray host atoms design R1 closure

**Baseline:** notification `c5f9cd99`, clipboard `5e46ddb7`, opener `6e84d41a`.
**Independent gate:** `openspec validate --strict` passed for all three changes.

## P1 closure ledger

| Package | R1 item | Revision mapping | Closure |
|---|---|---|---|
| notification | O1 Win32 projection and identity boundary | design-reference §2 freezes the broker composition capability table, scope-bound tray icon, typed `notification_tray_absent`/`notification_failed`, multi-mount replacement degradation, and WinRT-as-future-projection path | **Design closed** |
| notification | O2 async authorization without owner-loop blocking | design-reference §4 reuses DeferredOperation/completion port, 10 s timeout, and session-close cancellation; no new ABI | **Design closed** |
| notification | payload/DTO/denied semantics | design-reference §§1,3,4,5 freeze UTF-16 64/256/64, subtitle joint limit, complete DTO, denied linearization and zero-delivery spy | **Design closed** |
| notification | plan/spec stale against the revised SSOT | `plans/plan.md` still says O1/O2 pending, old 256/4096 bounds and no DeferredOperation; `spec.md` repeats old bounds and open adjudication | **Open P1; NO-GO** |
| clipboard | retry, null/write-clear, UTF-16 and DTO | design-reference §§1-3 plus spec §win32 requirement freeze the 2 s monotonic deadline, ACCESS_DENIED-only ladder, null distinction, 1 MiB and complete DTO | **Closed** |
| clipboard | HGLOBAL ownership/lifetime | design-reference §2 and spec §win32 mention HGLOBAL/deep-copy but do not state SetClipboardData success hand-off, failure cleanup, or GetClipboardData non-freeing copy semantics | **Open P1; NO-GO** |
| opener | strict scheme/path/COM/ShellExecute/DTO | design-reference §§1-4 freeze the allowlist, drive-relative/UNC/`\\?\`/`file:` matrix, rejection set, >32 acceptance and process-level COM discipline | **Design closed** |
| opener | plan/spec not synchronized to revision | `plans/plan.md` still marks O1 pending; `spec.md` retains conditional COM/open adjudication and quote-only reveal rule, omitting the revised path/result/DTO details | **Open P1; NO-GO** |
| opener | `/select` trailing-slash boundary | design-reference §2 unconditionally removes one trailing backslash; `C:\` becomes `C:`, changing root-path semantics (and UNC-root behavior needs an explicit rule) | **Open P1; NO-GO** |

## Scores and implementation waves

- **add-ext-notification: 6.5/10 — NO-GO** until plan/spec are rewritten to the frozen design; then implement as a separate complex wave.
- **add-ext-clipboard: 8.2/10 — NO-GO** until HGLOBAL ownership is explicit and tested; then parallelize with opener.
- **add-ext-opener: 7.0/10 — NO-GO** until SSOT synchronization and root/UNC trailing-slash handling are frozen; then parallelize with clipboard.

Recommended order after the listed P1 repairs: **Wave 1 clipboard + opener in parallel; Wave 2 notification alone**. The strict OpenSpec structural gate is green, but it does not waive semantic/document synchronization findings above.

## R2 closure (2026-09-18)

**Recheck baseline:** notification `cc6ec121`, clipboard `90ee4a26` + `93380cdc`, opener `7e9673bf` + `93380cdc`.
**Spec inspection:** no omissions found in the frozen requirements or scenarios.
**Independent gate:** `openspec validate --strict` passed for notification, clipboard, and opener.

| Package | R1 P1 | R2 evidence | Status |
|---|---|---|---|
| notification | stale plan/spec; O1/O2, bounds, DTO, bridge and auth transaction not carried into spec | plan/spec now carry O1=B scope bridge and errors, O2 DeferredOperation/completion-port/10 s/cancel, UTF-16 64/256/64, full DTO, bridge scenarios and three authorization scenarios | **Closed** |
| clipboard | HGLOBAL ownership and lifetime unspecified | design §2 and spec requirement/scenarios freeze system hand-off on successful `SetClipboardData`, `GlobalFree` for unhanded failures, and lock-copy-unlock read semantics | **Closed** |
| opener | stale plan/spec and unsafe root trailing-slash trim | plan/spec now carry strict allowlist, full path matrix, >32/SE_ERR, COM, rejection set, conditional trim, root no-trim and open-the-root scenario | **Closed** |

### R2 decision

- **add-ext-notification: 9.0/10 — GO (Wave 2, standalone)**
- **add-ext-clipboard: 9.2/10 — GO (Wave 1, parallel)**
- **add-ext-opener: 9.0/10 — GO (Wave 1, parallel)**

These are design-readiness decisions; native implementation, dual-target fixtures, and real-platform acceptance remain implementation gates.
