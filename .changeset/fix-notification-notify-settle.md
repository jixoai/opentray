---
"@opentray/ext-notification": patch
---

Fix: `notify` resolves through BOTH settle shapes. Darwin's first
snapshot-less notify legally defers (the authorization query runs inside
the 10 s budget, then the notification posts and the deferred terminal
resolves the acceptance — design sections 1-2), but the shipped facade
asserted Immediate-only, so every real first notify on a fresh install
rejected with "settles on the immediate path … received terminal" while
scripted-transport tests stayed green. Caught by the new host-atoms
acceptance panel (`example:hostAtoms`, scenario "notify — title only");
the stale immediate-only test is superseded by both-shape coverage.
