# ext-dialog / ext-sound R3 Architecture Review

**Review target:** 3dfadca3 on main, current worktree, 2026-09-17
**Scope:** openspec/changes/add-ext-dialog and openspec/changes/add-ext-sound. This is a design-readiness review, not implementation acceptance.
**Verdict:** add-ext-dialog NO-GO, 5.8/10. add-ext-sound NO-GO, 6.6/10.

## 1. Executive verdict

This revision makes substantial progress. The correct top-level choices are now stated in the living requirements: one caller-scoped session, getBackend() as a lazy async query, three fixed sound names, SND_ALIAS | SND_ASYNC | SND_NODEFAULT, a mutex-linearized PlaybackArbiter, finite WAV preflight, a real packed-tarball release proof, and a staging manifest with bytes identity.

The two changes cannot enter implementation yet. The generic deferred facility does not define the ABI transaction that issues a host handle, marks a command deferred, and decodes its terminal success/error. The modal scheduler does not specify a non-spinning way to drive runModalSession under ControlFlow::Wait. The Windows presentation ACK is not defined for IFileDialog::Show, and the cross-thread completion port has no thread/lifetime contract. The sound spec also still asserts the deliberately forbidden two-session scenario. These are choices about response ordering, native-thread ownership, and session cleanup, not wording details.

openspec:vision validate passes for both changes. openspec:vision check fails for both because each lacks review/self-review.md and review/self-review.html. git diff --check 3dfadca3^..3dfadca3 is clean. There is no native/facade implementation in this commit, so none of the planned native, packaging, or dual-target gates is implementation evidence.

## 2. R2 closure ledger

Status is assessed from the current design, plan, living spec, and tasks, rather than the commit summary. “Closed in text” is not a claim that production code exists.

| R2 item | Status | R3 assessment |
|---|---|---|
| P0-1 deferred response carrier | Not closed | Accepted/Terminal and a completion-port name are present, but command-to-handle issuance, terminal discriminant, port revocation, and the event barrier are unspecified. See P0-1. |
| P0-2 modal dispatch / Send | Not closed | Broker-owned poll_owner and per-owner STA are directionally correct; scheduler, IFileDialog presentation evidence, port cross-thread safety, and removal of the existing ExtensionInstance: Send requirement remain unspecified. See P0-2/P0-3. |
| P0-3 session model | Dialog closed; sound not closed | Dialog correctly retains the one-session broker. Sound still has an A/B concurrent-session lifecycle scenario. See P0-4. |
| P0-4 sound alias and purge race | Closed in design | Flags trio, native-false rejection, full token coverage, one-mutex linearization, and race tests are frozen. Native implementation proof is still outstanding. |
| P0-5 embedded identity chain | Partially closed | Root-contained staging metadata and real-byte replacement are required, but the current loader cannot verify a native manifest before Library::new and no concrete expected hash/buildIdentity LoadExt field is frozen. See P0-5. |
| P0-6 pack/unpack proof | Partially closed | The primary requirement says real npm pack plus unpack, but old dry-run wording survives in design/tasks. See P1-3. |
| P0-7 typed error / async DTO | Mostly closed | getBackend and a shared typed envelope are primary decisions, but stale synchronous backend text and the terminal error wire shape remain. See P0-1/P1-4. |
| P1-1 dual-target DTO wording | Closed in text | Both living specs require two target jobs and a complete common fixture without false cross-compilation causality. |
| P1-2 WAV preflight | Partially closed | Numerical limits are added, but RIFF declared-size arithmetic and fmt/data chunk bounds remain ambiguous. See P1-1. |
| P1-3 self-review/check | Not closed | Both check commands fail on the two missing self-review artifacts. |
| P1-4 picker/save semantics | Closed in text | Existing selection realpath and nonexistent save-leaf parent canonicalization are specified. |
| P1-5 sugar and overload types | Closed in text | MessageSugarOptions and narrowed pickFile overloads are specified with a type-test task. |
| P1-6 sound finite DTO promise | Closed in text | Darwin’s four-format commitment and Windows WAV-only set are finite and reflected in the DTO requirement. |

## 3. P0 blockers

### P0-1: DeferredOperation has no complete generic command-to-terminal ABI

Evidence:

- Dialog design section 5.1 names ExtCommandAccepted, ExtOperationTerminal, and port.submit(handle, json), but does not define how a command receives a host-issued handle, how it returns the deferred disposition, who allocates the operation ID, or the submit byte/ownership/error contract.
- “Payload always contains the extension result” conflicts with the typed dialog_dismissal_unavailable terminal error. There is no frozen success-versus-error discriminant that lets Node resolve a value versus construct TypedExtensionError.
- The requested terminal-before-event barrier cannot be implemented with the current EventPort input. ExtEventInputV1 has only tray route, data, class, and coalesce key, not an operation handle; EventPort law forbids inferring global source order.
- Current ext ABI has a per-call ExtHostContext and synchronous command output. The broker immediately emits ExtCommandResult, and the Node transport resolves and removes every request by requestId. The new deferred path is not defined against those existing frame and pending-map rules.
- A generic core client cannot emit a dialog-specific dialog_transport_closed branch. Generic transport death and facade-level error mapping must be separated.

Why this blocks: an implementer must invent incompatible C layouts and Node transitions. The result can be a Promise settled on Accepted, a permanently pending operation, or an error payload treated as a successful result.

Required repair and landing points:

1. In dialog design section 5.1, Requirement 1, and tasks 2.1/2.2, freeze one transaction: broker-issued opaque handle delivered only during command invocation; tagged command disposition immediate or deferred(handle); exact handle representation and forgery checks; submit input ownership and byte maximum; EXT_ERR outcomes; TerminalPayload = result(value) or error(TypedExtensionError); and terminal/revoke behavior.
2. Use the EventPort lifetime pattern for DeferredCompletionPort: immutable host-owned state, version and struct_size, bounded-copy submit, explicit CLOSED/invalid-handle/oversize returns, revocation before session/instance cleanup, and no freeing callable host memory while stale workers can submit. State whether submit opens only after LoadExt ACK.
3. Remove the claimed same-operation event barrier because dialog emits no EventPort event, or add an operation-correlated event field and per-operation sequencer. Do not claim an order the input cannot identify.
4. Freeze a generic extension_transport_closed error in shared spec. Let ext-dialog map it to public dialog_transport_closed; do not teach packages/cli to parse one extension name.

Verification: ABI layout and unknown-version tests; forged/stale/wrong-owner handle tests; success/error terminal round-trips in Rust, TS, Node, and Bun; close-before/after-accepted, duplicate terminal, and submit-after-revoke tests; a compile-time proof that core client has no dialog-specific branch.

### P0-2: macOS poll_owner lacks a scheduler and has starvation and busy-spin paths

Section 5.2 says the broker will merge/send wake and poll_owner will say it needs another step, but defines no poll result type, deadline, timer, coalescing rule, cancellation generation, or CPU budget. The actual winit loop uses ControlFlow::Wait, and the existing extension wake only drains EventPort records; there is no active modal scheduler.

Why this blocks: no follow-up wake stalls a visible modal forever; immediate self EventLoopProxy wakes can spin the owner loop. A later probe cannot repair a protocol that did not specify which behavior is legal.

Required repair and landing points:

Freeze in dialog section 5.2, the modal Requirement, and tasks 2.2/3.1: poll_owner returns Done or Pending with next_deadline and wake_reason; the broker owns one coalesced DialogPollDue(generation) event and uses ControlFlow::WaitUntil(min(deadline)) or a platform timer. Native callbacks may advance the deadline but may not retain a broker pointer or emit unbounded self-wakes. Revocation removes the schedule before endModalSession; stale due events fail generation checks. State a bounded per-owner work quota so menu and transport frames cannot be starved.

Verification: a Darwin probe and harness show terminal progress with no external event, bounded idle CPU/wake count, ordinary menu and transport completion between modal steps, and no AppKit call or duplicate terminal across exit/revoke races.

### P0-3: Windows STA design has no realizable presentation ACK or cross-thread FFI contract

Section 5.3 requires a per-owner worker and “presentation ACK before Accepted”, but freezes neither a worker cap nor a reliable presentation signal for TaskDialogIndirect, IFileOpenDialog::Show, and IFileSaveDialog::Show. IFileDialog::Show is synchronous; the design does not identify a documented pre-return shown signal. Worker completion is cross-thread into the proposed port, yet section 5.1 does not state Send/Sync, reentrancy, or independence from the extension instance. Current DynamicExtensionInstance is unsafe impl Send, and the core ExtensionInstance trait requires Send; “owner-thread registry” is only a desired result.

Why this blocks: a false Accepted=presented claim leaves callers awaiting an unseen dialog; moving COM/AppKit state across threads is undefined; an unspecified worker cap changes rejection semantics.

Required repair and landing points:

1. Run the Windows probe before finalizing the signal. For TaskDialog, use a documented callback such as TDN_CREATED if it proves the condition. For IFileDialog, prove a documented shown signal or change Accepted to the honest, testable meaning “worker entered native modal call”; never call queueing “presentation”.
2. Freeze numeric worker cap, worker-limit code, startup/ACK timeout, WM_APP close-message ownership, join timeout, and timeout policy. A full cap rejects before Accepted; it never silently queues.
3. In opentray-spec ext.rs define the port thread contract. In opentray-core extension.rs and opentray-bin dynamic_extension.rs remove the blanket ExtensionInstance: Send / unsafe impl Send for UI-affine instances or prove the instance is never moved; move only copyable request data and host-owned thread-safe port state to an STA worker.

Verification: per-API Windows probe; cap-minus-one/cap/cap-plus-one tests; cancellation on the owning worker; forced close/join-timeout test; instrumented thread-ID assertions that command/deinit remain on the owner thread and only the port shim crosses threads.

### P0-4: ext-sound still specifies a multi-session behavior forbidden by the runtime

Sound Requirement 1 correctly says the runtime remains single-session and concurrent same-tray multi-session scenarios must not appear. Its next lifecycle scenario nevertheless requires session A to play, session B to supersede it, then A to close while B remains alive. The current broker rejects a second caller session and kernel cleanup is session-based.

Why this blocks: the BDD is impossible in the supported process topology. It would force an unapproved shared-broker runtime change or fabricate a test.

Required repair and landing points:

Replace that scenario in sound spec with: (1) a deterministic PlaybackArbiter unit test may simulate two full CommandScope tokens and prove a non-owner close does not purge; (2) the current one-session integration test describes all loaded mounts receiving the one actual session-close sequence and the latest matching owner being purged once. If distinct mount teardown is required, add a separate runtime change that passes full scope, including instance generation, to cleanup. Update sound design section 1, task 3.2/6.1, and plan D4.

Verification: current-runtime integration proves one session only; separate arbiter tests cover simulated scopes, alias/file replacement, native-false, and every close ordering. No test names session B as a live caller in one broker until a multi-session change lands.

### P0-5: embedded identity verification is ordered impossibly and is not yet a load-ext schema

Dialog section 6.4 and Requirement 7 say the broker verifies the “actual embedded manifest build identity before Library::new”. The native manifest is an exported symbol inside the library; current loader calls Library::new first, then reads the manifest, before init. ExpectedExtensionIdentity currently has only extension name, artifact-set version, fingerprint, and target; current validation only requires a nonempty actual build identity. Neither hash nor expected buildIdentity is a LoadExt field.

Why this blocks: the written order cannot be implemented, and a byte substitution can still pass a nonempty identity check.

Required repair and landing points:

1. Node verifies platforms/manifest.json containment and SHA-256, then passes expected sha256 and buildIdentity in LoadExt / ExpectedExtensionIdentity.
2. Broker rehashes the exact resolved library path before dynamic load. It may verify the native library manifest only after Library::new and strictly before init; state this honestly instead of claiming before Library::new.
3. Release rehashes packed bytes and invokes the same-target inspector from the unpacked tarball. Document path-replacement TOCTOU separately; hashing a path then calling dlopen cannot eliminate every OS race.

Extend packages/spec index.ts, opentray-spec ext.rs, protocol.rs LoadExt serialization, cli native-extension-artifact.ts, and dynamic_extension.rs together. Sound’s embedded scenario must assert the expanded identity.

Verification: traversal/symlink/field-skew fixtures, real-byte replacement before Node resolve and before broker load, expected-vs-actual build identity mismatch, and same-tgz per-target inspector checks. Assert Library::new -> manifest validation -> init in a loader test.

### P0-6: the SSOT still contains retired protocol and can reintroduce it into AGENTS.md

Design-reference is labeled the implementation reference, but section 7 still says dialog.backend is synchronous; section 8 still names Completed/Cancelled, cross-session concurrency, and dry-run pack evidence; section 9 proposes the retired EventLoopProxy and Accepted/Completed/Cancelled law. Living requirements and tasks use async getBackend, one terminal, poll_owner, same-session isolation, and real tgz evidence.

Why this blocks: section 9 is explicitly a future AGENTS.md law source. Following it can restore an ABI-illegal DLL-held waker and removed frame family. This is a contradictory normative source.

Required repair and landing points:

Rewrite design sections 7.5, 8, and 9 and corresponding sound references to use only the R3 model. Add a document consistency gate forbidding ExtCommandCompleted, ExtCommandCancelled, readonly backend, same-broker cross-session acceptance, and dry-run as release evidence in these changes. Future law must say broker-owned scheduled poll capability, not EventLoopProxy.

Verification: grep gate clean, validate remains green, and every frame/DTO/pack requirement has one unambiguous source.

## 4. P1 important issues

### P1-1: WAV preflight is not yet an exact RIFF parser

The sound design/spec says little-endian RIFF declared length <= actual file size and a complete fmt/data chunk boundary. RIFF offset 4 is the length after the eight-byte RIFF header, so the checked relation is declared_size + 8 <= actual_size. The parser must require both fmt and data, ensure each chunk offset + 8 + size + pad stays inside the declared RIFF region, and define the minimum accepted fmt payload. Otherwise malformed or truncated files can satisfy the prose.

Landing: sound design section 1.4, playSound Requirement, task 4.2. Fixtures: 12-byte-only header, u32::MAX, declared-size-minus-eight, odd-byte padding, fmt-only, data-only, and chunk extending past declared versus physical length. The PlaySound spy must see no call on every reject.

### P1-2: STA limits and terminal failure taxonomy need values

“Bounded/frozen cap”, “join timeout”, and “dialog_busy family” appear repeatedly but no numeric cap, timeout, or exact rejection code is stated. Choose and record values, distinguish owner-busy from global worker-capacity exhaustion, and state the terminal result when a worker fails before presentation or refuses its close dispatcher.

Landing: dialog design sections 5.3/5.4, typed-error union, task 3.3, and Windows probe. Verify cap-minus-one/cap/cap-plus-one with no queued hidden dialog.

### P1-3: pack evidence is contradicted by dry-run tasks and sound scenario omits identity fields

Dialog section 6.3 begins by describing npm pack --dry-run for compressed size and section 8 repeats dry-run evidence. Sound task 6.2 asks only for a dry-run size gate. Neither can stat or unpack a tarball. Sound embedded scenario still asserts only the old three-field identity.

Landing: move dry-run to a non-release developer warning; make both task 6.2 paths invoke the real shared pack script and unpack the same artifact; update sound scenario with SHA-256/buildIdentity. A receipt must include tarball path and tarball digest.

### P1-4: public DTO references still use removed synchronous backend property

The dialog DTO scenario says the facade reads backend and design section 7.5 says dialog.backend, despite the API and primary requirement specifying getBackend(). Change both to await getBackend() and keep the immutable snapshot condition.

Landing: dialog design section 7 and DTO scenario. Add a TS type-test that backend is absent and getBackend returns a Promise of a read-only DTO.

### P1-5: OpenSpec delivery check is red

Both bun run openspec:vision -- check commands fail solely because review/self-review.md and review/self-review.html are absent. Tasks require them but they have not been created.

Landing: add both review artifacts under each change after correcting the design; rerun checks and record ok:true. This R3 report is not a replacement for either self-review.

## 5. Frozen decisions that are correct

- @opentray/ext-dialog and @opentray/ext-sound remain separate atoms; dialog and pickers remain one package; prompt, page bridge, and Linux native implementation remain out of scope.
- Dialog namespace rejection, button/index validation, default Windows cancellation, save-path shape, sugar narrowing, async DTO query, and COMCTL v6 broker-EXE RT_MANIFEST choice are soundly specified, subject to native probes.
- Sound mapping is frozen as notification -> Glass/SystemAsterisk, warning -> Sosumi/SystemExclamation, error -> Basso/SystemHand. default/info/question remain beep-only.
- SND_ALIAS | SND_ASYNC | SND_NODEFAULT, native-false sound_not_found, one-mutex PlaybackArbiter, no MessageBeep token, and finite Darwin formats are the right v1 boundary.
- The 2 MB warning / 3 MB split rule is preserved. Only actual packed-tarball measurements, not estimates or dry-run, can discharge it.

## 6. Minimal unlock sequence

1. Produce a shared-protocol amendment for P0-1: complete DeferredOperation handle issuance, terminal union, completion-port lifetime/error rules, generic transport error, and an honest event-order statement. Review it before native dialog work.
2. Freeze and probe the macOS scheduler and Windows STA presentation/thread model from P0-2/P0-3; remove the current generic Send assumption or demonstrate the stricter owner-thread shape in code.
3. Correct P0-4 so sound has no fictional multi-session BDD; retain simulated owner-token testing as an internal arbiter proof.
4. Correct P0-5’s loader order and add hash/buildIdentity to the actual LoadExt identity schema; align all dialog/sound release instructions on one real-tgz evidence command.
5. Remove P0-6’s retired prose, add self-reviews, and rerun both OpenSpec checks. Only then is batch A a coherent independently reviewable implementation unit. Sound may start only after that batch is implemented and verified, as its dependency gate intends.

## 7. Scores

### add-ext-dialog: 5.8 / 10 — NO-GO

The document now has a credible product/API boundary and corrected most R2 findings at the requirement level. It remains below GO because its shared deferred/FFI/scheduling/identity core is not executable and the appendix contradicts that core. Implementing batch A now would force host-wide protocol choices that should be frozen first.

### add-ext-sound: 6.6 / 10 — NO-GO

The sound boundary is materially stronger: alias flags, arbiter serialization, file validation intent, finite formats, and DTO semantics are substantially ready. It still depends on unresolved dialog batch-A protocol/embedded work, and its own session-A/session-B scenario directly contradicts the current runtime. It cannot begin implementation until the shared gate and that scenario are corrected.
