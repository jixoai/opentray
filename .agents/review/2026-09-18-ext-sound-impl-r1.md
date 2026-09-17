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

## R1 -> R2 Repair Verification

### P1-1: `getBackend` event shape -- closed

Both native emitters now produce the facade DTO: sound at
`crates/opentray-ext-sound/src/lib.rs:223-235` and dialog at
`crates/opentray-ext-dialog/src/lib.rs:295-305` emit
`{ type: "backend", backend }`, matching the sound parser at
`packages/ext-sound/src/shared.ts:50-62`. The sound fixture serializes that
native-shaped envelope and verifies both successful parsing and rejection of
the retired `result/getBackend` form at
`packages/ext-sound/src/index.test.ts:126-154,433-454`; dialog has the matching
fixture at `packages/ext-dialog/src/index.test.ts:327-346`. The native package
test includes `get_backend_answers_immediate_with_the_frozen_darwin_dto`.

### P1-2: WAV pre-read cap -- not closed as specified

The repair removes the separate pre-read `stat()` and opens once. Its loop at
`packages/ext-sound/src/index.ts:242-284` reads at most
`WAV_MAX_BYTES + 1` bytes from the file before rejecting. But it retains every
chunk and then makes a second full copy through `Buffer.concat(chunks, total)`
at line 278. An exactly-64-MiB file reaches byte validation with roughly 64 MiB
of chunk backing buffers plus a new 64 MiB contiguous buffer, rather than the
promised `cap + 1` byte memory maximum. The new sparse-file test verifies typed
rejection and zero transport frames, but does not observe this allocation peak;
its exact-cap case exercises the duplicate allocation.

Repair by filling one preallocated bounded buffer, or parse RIFF incrementally,
instead of retaining chunks and concatenating them. Add an injected file-handle
or allocator seam that records maximum retained payload capacity on an
exact-cap file.

`pnpm --filter ./packages/ext-sound exec vitest run` passed **28/28**.
`mbx test -p opentray-ext-sound -j 2` passed **26/26**. The requested
`mbx cargo test` spelling is unsupported by the local mbx wrapper; `mbx test`
is its Cargo-test entrypoint.

**Updated score: 8.3/10, up from 7.6.** The public `getBackend` breakage is
closed, but the remaining memory-bound violation is still a P1 at the frozen
Win32 file-ingress boundary. **Release chain: NO-GO** until it is fixed; after
that, the only remaining planned items are Windows E acceptance and full gates.

## R3 Repair Verification

### P1-2: WAV bounded-memory ingress -- closed

Commit `cacd8e9a` replaces retained chunks plus `Buffer.concat()` with two
passes over the same open `FileHandle` at
`packages/ext-sound/src/index.ts:242-293`. Pass one uses one reusable 64 KiB
buffer and rejects as soon as the accumulated byte count exceeds
`WAV_MAX_BYTES`; it retains no file payload. Pass two allocates exactly the
already-bounded count and fills it by explicit offsets. Thus an at-cap input
has one 64 MiB validation buffer plus the 64 KiB counter buffer, and an
over-cap input is rejected before allocating the validation buffer. Explicit
positions on the same descriptor also prevent a pathname replacement between
passes; a truncate is handled by validating only the readable prefix.

The existing boundary fixture at `packages/ext-sound/src/index.test.ts:592-616`
uses a sparse `WAV_MAX_BYTES + 2` file to assert pre-transport `size-cap`, then
uses an exact-cap non-RIFF file to prove the second pass reaches byte
validation. The implementation is direct enough to establish the corrected
peak-allocation bound; this commit adds no new test code, but retains the
relevant boundary test unchanged. `git diff --check cacd8e9a^..cacd8e9a` is
clean.

**Updated score: 9.2/10, up from 8.3.** Both R1 P1s are closed. This exceeds
dialog Batch A (8.8) and Batch B (9.0), and is comparable to Batch C (9.1):
the native arbiter and facade contracts are now coherent, with a remaining
platform acceptance boundary rather than an implementation blocker.

**Release integration: GO.** The remaining required release evidence is the
Windows P0 picker repair re-run, full gates, and merge; none is a residual
sound implementation P0/P1.
