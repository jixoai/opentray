# add-ext-sound Implementation Review R1

**Scope:** `main..HEAD`, Rust native extension and `packages/ext-sound` facade.

**Verdict:** **NO-GO** for the release chain. Two public-facade P1 defects remain.

## P0/P1 Ledger

| Severity | Finding | Evidence | Verifiable repair |
| --- | --- | --- | --- |
| P1 | `getBackend()` cannot consume the extension's actual immediate event. | `crates/opentray-ext-sound/src/lib.rs:223-230` emits `{ type: "result", op: "getBackend", backend }`; `packages/ext-sound/src/shared.ts:50-62` accepts only `{ type: "backend", backend }`. The V2 loader returns the extension-owned immediate byte buffer unchanged at `crates/opentray-bin/src/dynamic_extension.rs:1283-1284`, so there is no broker projection that reconciles the shapes. `ensureBackend()` consequently throws its contract error for a real response (`packages/ext-sound/src/index.ts:200-208`). | Freeze one common shape on both sides (change Rust to `backend`, or broaden and document the TS DTO), then add a crate-to-facade socket/ABI fixture using the actual native JSON. Assert `getBackend()` resolves and the mismatching form rejects. |
| P1 | Win32 WAV's 64 MiB pre-read guard is TOCTOU-vulnerable. | `packages/ext-sound/src/index.ts:241-259` checks a pathname with `stat()`, then separately calls unbounded `readFile()`. The target can be replaced or extended between calls, so more than 64 MiB may be read before `validateWavBytes()` runs, contrary to the frozen pre-read cap. | Open once, read through a bounded file-handle loop (at most `WAV_MAX_BYTES + 1`), and classify the excess as `size-cap`. Add a deterministic injected stat/read replacement test proving no full oversized read occurs. |

No P0 was found. Native-side review found no P0/P1: the arbiter lock orders native play/result/token changes and close purge; the seven gate-and-spy interleaving tests assert actual `SND_PURGE` and playback order. Native methods remain immediate and the Darwin/Win32 platform paths meet the reviewed contracts.

## Facade Contract Check

The three frozen generic-name projections resolve before platform projection; unknown names pass through to native lookup. Linux rejects before dispatch, unknown option keys throw before transport, and `getBackend()` retains an immutable asynchronous snapshot without exposing a synchronous backend property. The WAV byte validator itself correctly enforces RIFF/WAVE, minimum header, declared length, `fmt` and `data` chunks, odd padding, and the 64 MiB nominal bound. The separate pathname I/O makes that nominal cap unenforceable under mutation.

## Test Quality

`pnpm --filter ./packages/ext-sound exec vitest run` passed: **27/27**. The byte-level WAV fixtures, Linux zero-frame assertion, option rejection, and frozen snapshot assertions are meaningful. However, `ScriptedTransport`'s `backendEventResult()` at `packages/ext-sound/src/index.test.ts:112-122` fabricates `{ type: "backend" }`, masking the native event mismatch. It also cannot expose the `stat()`/`readFile()` mutation window. Add an ABI-shaped response test and bounded-I/O seam test before treating this suite as release evidence.

## Score And Release Decision

**7.6/10.** This is below dialog Batch A **8.8**, Batch B **9.0**, and Batch C **9.1** because a documented public method is currently unusable against its own native producer, and the resource cap is not upheld at its I/O boundary.

**Release chain: NO-GO.** Close both P1s and rerun the package suite plus relevant Rust/broker integration coverage. After that, the remaining planned evidence is Windows E acceptance, full gates, and merge; those may proceed only after this facade/native contract is coherent.
