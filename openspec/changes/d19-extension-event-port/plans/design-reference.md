# D19: Kernel <-> Dynamic Extension Asynchronous Event Channel

Date: 2026-09-13

## Decision

Recommend B'' — Host-owned Event Port + broker EventHub + coalesced loop wake,
with no phase-1 retain/release or detach protocol.

It retains proposal B's essential shape (bounded in-process mailbox, event-loop
wakeup, one existing ext-event transport path), but makes the C ABI object an
explicit host-owned, immutable, process-lifetime, revocable capability. The
handle is not an ABI reference-counted lease: phase 1 deliberately keeps its
backing state until broker exit because there is no unload path that can reclaim
it safely. It does not retain ExtHostContext, does not assume a single UI
thread, and does not claim that a bounded non-blocking queue can make every
semantic event lossless.

The EventHub belongs in opentray-bin, the current dynamic-extension host
composition layer. It is not an opentray-core product abstraction: core
continues to own app/tray/session validation and command dispatch, while bin
owns dynamic C ABI, native-loop wakeup, and byte transport.

    stable, owned capability                    one wake / burst
ext native callback ----------------> EventPort ----------------------+
any OS/native thread                  (bounded ingress)               |
                                                                      EventHub
                                                                         |
                                                    validates route + session authority
                                                                         v
                                                   ExtensionEventRouter
                                                         |
                                                         v
                                                   ServerFrame::ExtEvent
                                                         |
                                                         v
                                                     Node facade tap

command path:
 ExtHostContext.send_event --same EventHub ingress--> after response barrier
 returned command envelopes ------------------------> ExtCommandResult + mirror

The port is ext -> host only. Kernel -> extension asynchronous callbacks,
delivery acknowledgements, and process isolation are explicitly out of this
change. Adding those to this ABI would turn a small ingress interface into a
bidirectional runtime protocol with separate scheduling and teardown laws.

## Three Requested Reductions: Adjudication

1. **No `retain`/`release`: accept.** The concrete stale-producer sequence is
   `LoadExt(old) -> native callback copies the port -> session close or reload
   -> old instance deinit/dlclose -> callback calls try_submit`. Because phase 1
   revokes but never frees the host-owned state, that call reads only an atomic
   and returns `PORT_CLOSED` before reading the submitted bytes; it cannot enter
   the old extension, its `HostCallContext`, or a GUI object. The only way to
   make this unsafe is to reclaim the state early, which is forbidden and
   covered by the reload race test. A lease would add no safety while there is
   no reclaimable unload path.
2. **No detach / unload state: accept.** There is no reachable `UnloadExt`
   operation today (broker.rs:468-472). The only available teardown sequence is
   session close or instance drop, and the host can revoke before
   `session_closed`/`deinit`; no host callback waits for extension quiescence.
   A stale callback after `deinit` still reaches the immortal host state and
   gets `PORT_CLOSED`. Therefore no phase-1 sequence requires detach for memory
   safety. When real unload is introduced, a new optional symbol family must
   define quiescence and reclamation explicitly.
3. **Compile-time capacities: accept.** The event path is host-internal, so a
   consumer-configurable capacity would create an unreviewed memory/fairness
   contract. Fixed per-source/global/wake/input/source-generation limits make
   overflow and source exhaustion deterministic across all ext-*; changing a
   value requires code/spec review and new overflow evidence.

### B'' versus proposal B

| Concern | Proposal B sketch | B'' decision |
| --- | --- | --- |
| Placement | Kernel-owned queue | `EventHub` is an `opentray-bin` composition module; core receives only the already-routed product event. |
| Handle lifetime | Queue/port clone implied | One immutable host-owned `port_data` backed by process-lifetime state; no ABI retain/release. |
| Teardown | Drop-side invalidation left open | `PENDING -> OPEN -> REVOKED`; revoke precedes session cleanup, reload, deinit, and shutdown. No phase-1 detach/unload. |
| Scope | Existing claimed envelope scope | SourceKey binds app, extension instance, session, and generation; submit supplies only tray id and data. |
| Overflow/wake | Queue and wake suggested, semantics open | Fixed per-source/global/source-count caps, three classes, round-robin drain, coalesced platform wake, explicit result codes. |

## Evidence First: What The Checkout Actually Does

### ABI and lifetime

opentray-spec/src/ext.rs:8-35 fixes ABI 3 and eight required exports.
ExtHostContext is a bare host_data plus call functions (ext.rs:91-113), not an
owned host object. In the dynamic loader, HostCallContext is a local variable
in both command and session_closed (opentray-bin/src/dynamic_extension.rs:
383-459); as_ffi() puts that stack pointer in host_data (:576-592). Retaining
it after either FFI call is use-after-stack-return. This is a proved limitation,
not a warning that an extension can realistically work around.

The loader validates embedded manifest identity before init, requires exact
EXT_ABI_VERSION, keeps the Library in the instance, and calls deinit in Drop
(dynamic_extension.rs:255-347, :463-469). It also marks the dynamic instance
unsafe impl Send (:266) while its C instance can contain platform-thread-bound
state. That is an additional reason the persistent ingress must never call back
into an extension or GUI object from its producer thread.

The second extension reference confirms the generic boundary. ext-badge exports
the same ABI-3 symbols; its command receives an ExtHostContext but deliberately
does not use it, serializes command results as ExtensionEnvelope values, and its
session_closed export returns an empty event array
(opentray-ext-badge/src/lib.rs:117-218). Badge therefore needs no invented
polling or WebView dependency to adopt EventPort later: it can attach only when
it gains a genuine asynchronous native producer. The standard must not make
every low-frequency command-only extension manufacture a heartbeat.

The WebView ABI support is likewise generic: `src/abi_support.rs:22-49`
exports the manifest and structured `take_error` transport, while
`src/lib.rs:342-356` defines `HandledCommand` as response plus push-event
envelopes. That is the right migration seam: EventPort replaces only the
native-to-extension outbox delivery point; it does not change manifest identity,
command parsing, or the Node-facing envelope shape.

### Current routing and its real delivery point

Core's host trait has a synchronous &mut self send_event
(opentray-core/src/extension.rs:10-27). Kernel dispatch enters it only via
Kernel::ext_command_with_host (kernel.rs:307-328); broker wraps it with a
command-scoped host and writes ExtCommandResult followed by mirrored ExtEvents
(broker.rs:409-441).

The production ExtensionEventRouter records only (appId, instance) -> creator
session, produces a RoutingExtensionHost with Vec<ExtensionEnvelope>, and drains
it only after dispatch (opentray-bin/src/extension_events.rs:75-120,
:158-205). It validates an envelope but, outside a command scope, currently
trusts a claimed scope. The router has no persistent queue.

The native loops first write response frames, update load ownership, forget a
closing session, then call deliver_extension_events(host.take_events())
(main.rs:736-766; Linux unix_transport.rs:189-220). So current send_event has a
useful response-after ordering property, but only while a host vtable exists.

### D19 is currently callback -> outbox -> next command, not push

macOS records native title/focus/load callbacks into
Rc<RefCell<VecDeque<WebviewEventFrame>>> (opentray-ext-webview/src/macos/mod.rs:
120-140, :200-307) and MacosWebviewRuntime::handle() flushes it after an
arbitrary command (:540-564, :2285-2291). Windows does the equivalent with
SessionEventCore.outbox (windows/orchestration.rs:84-148), and drains it only
in flush_pending_events (windows/mod.rs:1017-1025). The WebView2 observers
explicitly route into that outbox (windows/orchestration.rs:318-382 and
windows/mod.rs:2440-2463).

Thus an idle browser can create a valid urlChange, then expose it only after a
later unrelated command. The source comments accurately say not the 16 ms
drain, but not immediately delivered. The latter is the D19 gap to close.

### Thread topology: answers constrained by code evidence

Target | Verified topology | Consequence
--- | --- | ---
macOS | run_broker creates a Winit user-event loop with ControlFlow::Wait; Unix listener/reader threads turn socket input into UserEvent::Transport through EventLoopProxy (opentray-bin/src/main.rs:562-605, unix_transport.rs:75-118, :335-355). Extension dispatch occurs from NativeBrokerApp::user_event / handle_transport on that loop (main.rs:647-666, :684-766). WebView code uses Rc<RefCell> and requires MainThreadMarker in UI paths. | The broker mutation/UI path is serialized by Winit. AppKit/WK callbacks are intended to share the UI execution context, but this checkout does not itself prove Wry callback-affinity. Do not make it an ABI premise.
Windows | A named-pipe accept thread and one pipe-pump thread emit transport events (windows_transport.rs:77-123, :168-190); Winit EventLoopProxy returns them to the native loop. WebView2 callbacks capture Rc and comments state they run on the UI thread (windows/orchestration.rs:318-366). Windows UI setup enters an STA in the extension. | Current callbacks are UI-thread-affine, but ingress must be safe from a different native callback/worker because the ABI promises all ext-* and the loader advertises Send. No producer may touch STA/UI/kernel state.
Linux | There is no running KSNI event loop in this checkout. run_blocking_broker owns a std::sync::mpsc receive loop (unix_transport.rs:128-149, :313-332), while Unix listener/readers are threads. KsniBackend is a PhantomData/capability stub whose sync and emit operations are no-ops (opentray-backend-ksni/src/lib.rs:1-41). | The brief's Linux ksni loop is not code truth. Wakeup here is an mpsc broker event, not eventfd unless Linux gets a real native loop later.

Conclusion: a same-thread delayed flush (option C) cannot be the standard.
Winit's proxy supplies the macOS/Windows wake mechanism, and the Linux receive
channel supplies the current one. The generic ABI should only say request a host
drain; it must never expose CFRunLoopSource, HWND/PostMessage, or eventfd.

### Existing polling remains real

The public ext-webview facade defines a 16 ms WINDOW_EVENT_POLL_INTERVAL_MS and
the legacy event set (packages/ext-webview/src/index.ts:768-781), sends
drainWindowEvents, then starts a setInterval (:1056-1117). That path also drives
app-reopen activity tracking through listener accounting (:1169-1190).
Permission polling is another independently scoped 16 ms path in the same file
(:1126-1167) and must not be silently claimed as solved by this design.

### Existing AGENTS.md laws that constrain this seam

- **Extension Host / package boundary:** core keeps generic tray/runtime
  contracts; WebView methods and event kinds belong to `ext-webview`. EventPort
  therefore remains a generic ext ABI in `opentray-spec`, while product event
  classification stays in each extension.
- **Dynamic Loading:** the loader receives one exact facade-resolved library,
  validates embedded extension identity before `init`, and preserves structured
  rejection detail. EventPort capability is an optional symbol layered on that
  same artifact/contract fingerprint; it must not become a second discovery or
  versioning system.
- **Darwin carrier:** AppKit/carrier ownership remains in the runtime/broker
  composition layer. `opentray-core` cannot import AppKit, and the EventPort ABI
  cannot expose `CFRunLoopSource` or a carrier pointer; the wake adapter is the
  only platform projection.
- **WebView polling cost:** an idle Winit broker uses `ControlFlow::Wait`, but
  the facade's 16 ms `drainWindowEvents` interval still creates roughly 60
  native drain requests per shown window. Phase 1 removes that cost only for
  migrated direct events; phase 2 must separately account for permission
  polling and the remaining legacy event family.

## B'' Interface

### Ownership model

The host creates an EventPort state for a specific loaded extension source:

    SourceKey = {
      generation: u64,
      owner_session_id: SessionId,
      app_id: AppId,
      instance_name: String       // mountId || extension name
    }

app_id, instance_name, and owner_session_id are host facts; an extension never
supplies or overrides them. A submitted record carries only a tray route and
extension-defined JSON data. On drain, the host confirms that the tray is still
live and belongs to the source session/app before constructing ServerFrame::
ExtEvent. This removes the current scope-free cleanup path's claimed-scope trust
from asynchronous traffic.

The port backing state is EventPortState in the broker EventHub. Phase 1 gives
the extension one immutable port value; the host owns the state for the entire
broker process and deliberately does not reclaim it after revoke. This is a
small, bounded-per-load process-lifetime allocation. No host callback enters the
extension and no host thread dereferences extension memory. submit never calls
core, locks a writer, performs socket I/O, or touches an OS GUI handle.
`try_submit` is multi-producer safe (`Send + Sync` at the capability level); its
linearization point is the short state/queue gate, not a presumed UI thread.

The C ABI has one optional attach symbol in phase 1. Keeping required ABI-3
symbols unchanged is intentional: changing ExtContext in place is an ABI break,
while forcing all released extensions to ABI 4 defeats staged rollout.

    // conceptual repr(C) ABI; concrete code uses extern C
    const EXT_EVENT_PORT_ABI_V1: u32 = 1;
    const EXT_SYMBOL_ATTACH_EVENT_PORT_V1 =
      "opentray_ext_attach_event_port_v1";

    repr(C) struct ExtEventRouteV1 {
      ExtBytes tray_id;          // borrowed UTF-8, non-empty
    }

    repr(C) struct ExtEventInputV1 {
      ExtEventRouteV1 route;
      ExtBytes data_json;        // borrowed JSON value
      ExtEventClassV1 class;
      ExtBytes coalesce_key;     // required only for Latest
    }

    repr(u32) enum ExtEventClassV1 {
      Edge = 1, Latest = 2, BestEffort = 3
    }

    repr(C) struct ExtEventPortV1 {
      u32 abi_version;
      u32 struct_size;
      *mut c_void port_data;     // one immutable process-lifetime handle
      extern C fn try_submit(*mut c_void, ExtEventInputV1) -> ExtResultCode;
    }

    type ExtAttachEventPortV1Fn =
      unsafe extern C fn(instance: *mut c_void,
                         port: ExtEventPortV1) -> ExtResultCode;

    // Added to the existing ABI-3 result-code space; values are frozen.
    const EXT_ERR_BACKPRESSURE: ExtResultCode = 4;
    const EXT_ERR_PORT_CLOSED: ExtResultCode = 5;

Transfer rules:

1. On successful attach, the extension may copy the immutable port struct for
   use by any of its own producer threads. The host state remains valid until
   broker process exit; no retain/release is required in phase 1.
   `try_submit` points to broker code, not a symbol in the extension library,
   so dropping the extension library cannot invalidate the function pointer.
2. On attach error, the extension must not retain or call the port. The host
   keeps the state allocation until process exit and marks it revoked.
3. The host atomically changes OPEN to REVOKED before session cleanup or broker
   stop. After that, try_submit returns EXT_ERR_PORT_CLOSED and makes no queue
   mutation.
4. ExtBytes is borrowed only for try_submit; EventHub copies bounded bytes before
   returning. No ExtOwnedBytes crosses this ingress because the host must not call
   the extension's free_string from an arbitrary native thread.
5. Phase 1 has no detach symbol and no unload protocol. An extension's native
   callback teardown remains its existing deinit discipline; this change adds no
   callback from host into extension and no new pointer to extension memory.

The loader passes `struct_size == sizeof(ExtEventPortV1)` and requires the exact
EventPort ABI version, non-null `port_data`, and a non-null `try_submit` pointer.
The host rejects unknown event-class values, empty/non-UTF-8 tray ids, invalid
JSON, an oversized data/key field, or a `Latest` record without a bounded key.
`ExtBytes` is length-delimited and need not be NUL-terminated. The extension
never frees or mutates any field in the port; copying the small port value is
the only form of handle sharing.

`ExtEventRouteV1` is deliberately tray-scoped: the current
`ServerFrame::ExtEvent` path and router drop tray-less envelopes, so an empty
tray id is not a hidden app-scoped broadcast. If a future extension needs
app-scoped asynchronous events, it must add a versioned route variant and
contract fingerprint; phase 1 does not overload this field with a sentinel.

Add EXT_ERR_BACKPRESSURE and EXT_ERR_PORT_CLOSED for the event-port capability.
Existing ABI-3 operations keep their current result-code space. The extension
must emit structured take_error detail for malformed input/attach failures;
backpressure and closure are expected control results and do not mutate the
global last-error slot.

### Why not add it to ExtContext

ExtContext has no struct_size, reserved tail, ownership hooks, or versioned
substructure (ext.rs:85-89). Appending a raw port would make old libraries read
one layout while hosts write another, and it would hide a transfer contract
inside init. A single optional attach symbol is enough for phase 1: absent
means legacy response flushing, present means the loader validates one
versioned port and invokes it once. There is no partial symbol pair to reason
about and no host-to-extension callback that would require a quiescence
handshake.

This reduction is sound only because the host state is intentionally immortal
for the broker process and the port is ext -> host only. It is not a general
lifetime protocol. If a future `UnloadExt` makes reclamation necessary, it must
introduce a new optional symbol family and a new compatibility fingerprint;
phase 1's port contract is not silently widened.

### One standard, four extension shapes

The attach point is generic; the extension owns only the producer-to-event
mapping and class declaration:

| Extension shape | Phase-1 behavior | Required discipline |
| --- | --- | --- |
| `ext-webview` | Attach one port per loaded instance. Native WebView callbacks submit the D19/D23/D24 records using the normative table below. | Never call `ExtHostContext` from a native callback; copy payload bytes during `try_submit`; retry Edge backpressure on an extension-owned bounded scheduler without blocking AppKit/STA callbacks. |
| `ext-badge` | Omit the optional symbol when the extension has no asynchronous producer; keep current command-result behavior. | Do not manufacture a heartbeat or polling loop just to exercise EventPort. If a later native badge observer exists, attach and classify its records under the same three classes. |
| `island` / tray utility | Attach only if it has a real native callback source; route by the tray id supplied to `try_submit`. | Source identity, app id, instance name, and generation come from the host, never from event JSON. |
| Third-party / future extension | Use the same `ExtEventPortV1` and optional attach symbol; publish its event-class and overflow contract in its manifest fingerprint. | No core or broker branch for extension-specific kinds; old hosts use the extension's declared legacy fallback. |

This keeps the interface deep: one C attach plus one bounded submit operation
buys wake coalescing, fairness, routing, teardown invalidation, and transport
delivery for every extension. Product-specific schemas stay behind the
extension's own implementation and contract.

### Host implementation sketch

    EventHub (opentray-bin)
      sources: SourceKey -> PortState { phase, owner, queues, metrics }
      phase-1 states: PENDING -> OPEN -> REVOKED
      port state allocation: process-lifetime, never reclaimed in phase 1
      ready_sources: FIFO round-robin list
      global_budget + per-source budget
      wake_pending: AtomicBool

    PortState.phase: PENDING -> OPEN -> REVOKED

DynamicExtensionLoader receives the EventHub from runtime composition. It
resolves mandatory ABI-3 symbols exactly as it does now, optionally resolves
the one attach symbol, calls init, then calls attach with a PENDING source port. It
never exposes EventHub to core. The native loop performs note_loaded_and_open()
only after the LoadExt ACK path has registered the owner. A native callback racing
load can enqueue while PENDING but cannot be delivered; a failed load revokes
and discards it. A reload uses a fresh generation, so a delayed callback from the
replaced mount cannot be mistaken for the new same-name source.

    extern C fn try_submit(port: *mut c_void, input: ExtEventInputV1) -> ExtResultCode {
      state = stable_process_lifetime_state(port);
      let Some(gate) = state.admit_submit() else {
        return EXT_ERR_PORT_CLOSED; // do not dereference input after revoke
      };
      record = validate_and_copy_bounded(input); // bytes are borrowed only under the gate
      match gate.enqueue(record) {
        Enqueued | Coalesced => { state.hub.request_drain_once(); EXT_OK }
        Full => EXT_ERR_BACKPRESSURE,
        Closed => EXT_ERR_PORT_CLOSED,
        Invalid => EXT_ERR_REJECTED,
      }
    }

    // only the broker owner loop runs this
    fn drain_extension_events(&mut self) {
      for item in event_hub.drain_round_robin(64, 128_KiB) {
        if source_is_open_and_owns_live_tray(&item.source, &item.tray_id) {
          router.deliver_bound(item.source, item.tray_id, item.data_json);
        } else {
          metrics.drop_revoked_or_stale(item.source);
        }
      }
      event_hub.rewake_if_ready();
    }

For macOS and Windows, request_drain_once() calls
EventLoopProxy<UserEvent>::send_event(UserEvent::ExtensionEventsReady). The
native loop adds a UserEvent arm that performs the bounded drain. For present
Linux, it sends BrokerEvent::ExtensionEventsReady through the same blocking
receiver as socket transport; TransportEvent should be wrapped in a broker-event
enum. This is a host adapter, not a C ABI difference. A future Linux native GUI
loop can replace only this adapter.

If the platform wake send fails, the adapter marks ingress unavailable, records
a structured wake-failure metric, and revokes sources during shutdown handling;
it must not clear `wake_pending` and spin or leave accepted records stranded
while claiming delivery.

The EventHub owns queues, not raw incoming JSON views. The brief's "already
serialized bytes zero extra cost" is only partially true: ingress avoids a
second FFI serialization, but current routing must parse JSON to validate it and
serialize a ServerFrame to the socket. Do not promise zero CPU/copy. Preserve
raw data_json behind an internal abstraction now; optimize later only if frame
validation and error semantics remain unchanged.

`port_data` is not a raw pointer to the owner loop. It addresses an
`EventPortState` held by a process-lifetime ingress registry. The registry owns
the state and its small `HubIngress` (atomics plus queue gate); the owner loop's
`EventHub` handle may stop draining, but it is never the lifetime owner of that
pointer. Shutdown first marks every state REVOKED and closes the ingress; the
registry is dropped only as the broker process exits. Thus a stale native thread
after deinit or loop shutdown can read the state, get `PORT_CLOSED`, and cannot
reach a freed queue or a raw `EventHub` address. `admit_submit` and revoke take
the same short gate: a revoked call returns before it touches `ExtBytes`, and a
call that was admitted before revoke completes its bounded copy/queue mutation
before the revoke linearization point.

## Queue, Backpressure, and Ordering Contract

### Capacity and fairness

Use fixed budgets, configured internally rather than exposed as consumer API:

    per source:  128 records OR 256 KiB, whichever first
    whole broker: 1024 records OR 2 MiB, whichever first
    per wake: 64 records OR 128 KiB round-robin quantum
    retained source generations: 4096 (including revoked states)
    max input: 64 KiB data JSON, 128-byte tray/coalesce key

These are starting safety bounds, not claims that traffic facts prove an ideal
number. The source-generation cap is a hard safety bound required by the
phase-1 no-reclamation decision: after 4096 generations the next EventPort
attach is rejected with structured `event_port_source_limit` and the broker
must be restarted before another port can be created. Instrument high-water
bytes/records, backpressure, coalesced, dropped, stale-source drops, source
limit rejects, and drain latency. Tune only from recorded host evidence.
Per-source bounds and round-robin drain are required: a single global FIFO lets
one noisy third-party extension starve badge/island and GUI events.

No ingress operation may block on socket I/O, wait for a GUI loop, or spin. A
short internal critical section is permissible; a lock-free bounded queue is
preferred only if it preserves the stated semantics and is measured. The
architecture does not depend on a particular crate.

### Three event classes

Class | On full queue | Semantic contract
--- | --- | ---
Latest(key) | Replaces the pending item for the same source/key, preserving one pending position; otherwise BACKPRESSURE. | State truth where eventual latest snapshot is sufficient. The producer supplies a stable key and, where the product contract has one, a sequence/query resync route.
Edge | Never silently discarded; returns BACKPRESSURE. Producer owns bounded retry/coalescing on its own scheduler. | Discrete lifecycle/audit events where dropping is worse than delayed delivery. Accepted means retained until delivered or source/session closes, not process-durable.
BestEffort | Drop newest and increment structured metrics; return EXT_OK so it cannot become a callback hot loop. | Telemetry/visual hints whose contract explicitly permits loss.

For a `Latest` replacement, the new payload is re-accounted against both the
per-source and broker byte caps. If it would exceed either cap, the old pending
item remains and the call returns `BACKPRESSURE`; the hub never evicts another
key to make room. A successful `Edge` call means the record is queued, not just
observed by the producer. A failed `Edge` call is not accepted and must follow
the extension's bounded retry/recovery contract.

The generic channel does not assign a product event's class. Each extension's
contract does. This keeps badge/island/webview/third-party semantics out of core
and prevents a false universal reliability promise.

For webview, urlChange must be Latest(webviewId + "/url"), not best-effort. Its
existing {value, seq} query pair is the repair mechanism: after subscription, a
consumer receiving a sequence gap queries getUrl() and accepts the higher
sequence. Intermediate navigation can be coalesced while the address bar
converges to actual URL truth. The facade must add explicit gap/resync behavior;
current sequence values alone do not repair a silently lost frame. titleChange
follows the same pattern.

The WebView contract below freezes that product decision for this release. The
three navigation phases are Edge; progress observations are BestEffort. A
single wire `loadState` kind therefore has two ingress classes selected by the
native producer from its phase/payload. The class is queue policy, not a new
Node-facing field.

### Ordering

1. A successful try_submit linearizes one item. Per source, EventHub preserves
   that linearization order except an explicit Latest replacement. Multiple
   producer threads have no intrinsic temporal order; lock acquisition order is
   the contract.
2. There is no total ordering between different sources, native tray events, or
   transport requests. Fair draining intentionally rejects a global FIFO promise.
3. Events submitted during an ExtCommand run are delivered only after the
   handler returns and after that command's response frames are written, because
   the owner loop cannot drain while handling the command. This preserves the
   existing response barrier.
4. Returned command envelopes remain response data and retain existing
   ExtCommandResult/mirror behavior. ExtHostContext.send_event submits a
   source-bound item to the same EventHub, scheduled at the existing
   post-response barrier; it no longer owns a separate Vec queue.
5. An event already ready before a later command may be delivered before that
   command's response. Callers requiring causality use extension-defined
   sequence/domain state, not cross-source arrival order.

## Lifecycle State Machine

    load:     PENDING --ACK/open--> OPEN --session close/reload--> REVOKED
       attach failure -----------------------> REVOKED
    shutdown: any state ---------------------> REVOKED (no delivery guarantee)

Transition | Host action | Observable result
--- | --- | ---
load / attach | Reserve one source slot; create PENDING port; if the optional symbol is present, validate the versioned port and invoke attach once. Only a successful LoadExt ACK opens it. | Pre-ACK records stay private; failed attach/load changes PENDING to REVOKED and drops them. A source-limit rejection is structured and occurs before attach.
session close | Atomically change OPEN to REVOKED before core `session_closed`; discard queued records; submit returns `PORT_CLOSED`; then clean native extension state. | No frame can cross a closed or recycled session.
instance drop / reload | Revoke the old generation before `deinit`/library drop. The process-lifetime state remains addressable solely to return `PORT_CLOSED`; no host callback or queue delivery occurs. | A stale producer cannot route under a new same-name generation and cannot dereference freed extension memory through this port.
broker shutdown | Revoke all sources, discard queued records because transport is departing, then run existing owner-loop deinit/drop and stop listener/event loop. Process exit finally frees the retained states. | No promise to flush on process termination; no dangling callback into freed host state.

`UnloadExt` is explicitly unsupported (broker.rs:468-472), so phase 1 has no
unload transition, drain-before-unload promise, or detach symbol. The current
registry also keys instances only by (appId, instance) and broadcasts
`session_closed` to all instances
(extension.rs:126-172). That is contained by current single-session broker
admission. Before multiplexed brokers or real unload, registry ownership must
carry SourceKey/generation and cleanup must select owners, not broadcast.

## ABI Compatibility and Artifact Matrix

Manifest identity remains a hard loading gate: extension name, ABI version,
artifact set version, contract fingerprint, target, and non-empty build identity
are checked before init (dynamic_extension.rs:280-315). Do not infer EventPort
availability from error text or package version.

Host / extension | Required ABI-3 and identity | Optional attach symbol | Result
--- | --- | --- | ---
H0 legacy / E0 legacy | match | absent | Current response-flush behavior.
H1 EventHub / E0 legacy | match | absent | Loads and reports asyncEventPort unavailable; legacy only.
H0 legacy / E1 port-aware | match | host never probes | E1 retains its declared legacy fallback; no idle push.
H1 / E1 | match | symbol present and attach succeeds | B'' direct EventPort enabled.
any / mismatch | mismatch | irrelevant | Reject before init; structured category remains authoritative.
H1 / bad port version/size or attach contract violation | match | symbol present; validation/attach fails | Reject as `event_port_abi_incompatible`; malformed, not silent fallback.
H1 / explicit unsupported attach | match | symbol present, returns UNSUPPORTED | Load legacy only if the extension manifest declares fallback; otherwise reject.
H1 / source-generation cap exhausted | match | symbol present; host cannot reserve a source slot | Reject with structured `event_port_source_limit`; no instance is opened and no port is handed to the extension.
any / ABI 4 (or another required ABI) | mismatch | irrelevant | Reject before `init`; there is no ABI-3-to-ABI-4 adapter hidden behind EventPort.

The package contract fingerprint must change when a facade starts requiring direct
event semantics. A fingerprint that only permits fallback may interoperate with
H0. The loader records EventPort capability state and resolved path/build
identity; this extends, rather than weakens, compatible-artifact law. `EXT_ABI_VERSION`
remains an exact required value (`3`); `EXT_EVENT_PORT_ABI_V1` is a nested
capability version and cannot relax the manifest's ABI, target, artifact-set,
contract-fingerprint, or build-identity checks.

## Alternatives: Decision Table

Option | Decision | Why
--- | --- | ---
A. callback registry + long-lived raw cookie | Reject | It externalizes lifetime, teardown, retained-callback, and dlclose races to every extension. A void pointer without an owned lease is the current HostCallContext fault line.
B. mailbox + loop wake | Accept as B'' | Correct direction; B'' adds source binding, process-lifetime host ownership, explicit revoke, fairness, backpressure, and target-neutral wake without inventing a phase-1 lease or unload protocol.
C. same-thread deferred flush | Reject as common standard | Current macOS/Windows dispatch looks serialized, but Linux is a different receive loop and third-party/native callbacks can be concurrent. It cannot fulfill any-thread or survive topology change.
D. per-extension process + socket | Reject for this phase; retain as future adapter | Strong isolation, but incompatible with current AppKit carrier/HWND/STA ownership for ext-webview and introduces a large process protocol. Byte-oriented EventPort leaves a seam for later.

## Open Questions: Explicit Rulings

1. Thread topology: answered above. macOS/Windows command mutation is
   serialized through Winit; readers are background. Linux is a blocking mpsc
   broker with a KSNI stub, not a KSNI loop. ABI is thread-safe by design, not
   by presumed AppKit/STA affinity.
2. ABI shape/bytes/identity: one optional attach symbol after init; the host
   passes an immutable process-lifetime port, and bytes are borrowed for submit
   then host-copied. EventPort version/size is separate from EXT_ABI_VERSION;
   existing manifest identity stays mandatory. Matrix is normative.
3. Invalidation: source is revoked before session cleanup or instance drop;
   reload and shutdown discard queued records without a flush guarantee.
   Post-revoke submit is always a safe `PORT_CLOSED` result because the state is
   retained until broker exit. There is no phase-1 unload drain.
4. Backpressure: bounded per-source/global budgets and metrics. Never block
   native callback. Latest coalesces, Edge returns backpressure, best effort
   drops with metrics. No universal lossless claim.
5. Order: per-source submit linearization, with documented Latest replacement;
   no global order. Command ingress comes after response. Payload sequences carry
   recovery.
6. Common surface: all ext-* get only one optional attach and the port's
   `try_submit(route,data,class,key)` operation. No detach, retain, release,
   webview fields, kernel->ext async, app/theme/window specialization. Name it
   Extension EventPort.
7. Router/scope: port binds source identity at LoadExt; extension supplies only
   tray route. Drain validates live tray/session ownership and creates server
   frame. Async code never supplies appId or ext.
8. Legacy migration: phase 1 installs EventHub and moves D19 native WebView
   callback producers first. Phase 2 moves legacy window events used for
   focus/blur/visible/style/reopen, deletes drainWindowEvents and facade interval
   only after parity gates. Permission resolution is separate request/reply; do
   not force it through one-way EventPort.
9. Tests: deterministic EventHub race/overflow/identity tests plus native-loop
   adapter smoke; no test claims physical GUI affinity it did not exercise.
10. Five-year check: byte-record ingress and host wake adapters scale to more
    extensions; per-source budgets prevent domination. First decay is misuse of
    BestEffort/Latest, so contracts, metrics, and recovery are mandatory. A
    process split replaces EventHub implementation, not event record contract.

### Five-year pressure test

| Pressure | What remains valid | First failure point and guard |
| --- | --- | --- |
| 10x loaded sources | Source-bound queues and round-robin draining keep one extension from monopolizing the broker; the wire frame and class/key record do not change. | Permanent phase-1 source states hit `EVENT_HUB_MAX_SOURCES`; attach fails explicitly and a broker restart is required. A future unload protocol can remove this operational limit only after it owns reclamation. |
| 100x event frequency | `try_submit` never waits for socket/UI I/O; Latest reduces state churn and BestEffort is intentionally lossy; the wake is coalesced and each drain is bounded. | Edge producers see `BACKPRESSURE`. Their extension contract must use a bounded retry/recovery policy; if that policy cannot preserve an edge, the extension must expose that loss rather than silently claim delivery. |
| Real process split later | `ExtEventInputV1` is length-delimited bytes plus class/key, and SourceKey binding is host-side. An IPC adapter can replace the in-process ingress while preserving routing and overflow semantics. | Shared-memory ownership, cross-process identity, and acknowledgement would be a new protocol. Do not smuggle them into phase 1 or reuse `port_data` across processes. |

The likely architectural decay is semantic: an extension labels a state as
`BestEffort` merely to avoid backpressure, or labels a high-rate edge as
`Edge` without a retry path. Manifest fingerprints, the normative event table,
structured counters, and contract tests are the guardrails; the kernel must not
guess or silently upgrade a class.

## Phased Delivery and Gates

### Phase 1: generic port, without lying about migration

1. Add EventPort ABI types, the single attach symbol, structured errors, and
   optional-symbol probing in crates/opentray-spec/src/ext.rs. Do not change ABI-3
   required symbols or mutate ExtContext.
2. Implement EventHub in opentray-bin with source key/generation, PENDING
   activation, bounded fairness, metrics, and host wake adapter.
3. Add ExtensionEventsReady to Winit user events and a Linux broker-event union.
   Keep delivery/core mutation on the existing broker loop.
4. Bind source ownership at successful LoadExt; revise router delivery to take
   bound source + route instead of extension-claimed scope. Preserve existing
   response-return event behavior.
5. Implement EventPort in ext-webview and move D19 title/url/focus/geometry/load
   callback producers from outbox to the port. Keep domain seq, subscriptions,
   and query contracts. Edge records use an extension-owned bounded retry queue
   or scheduler; native callbacks never block waiting for hub capacity. Badge
   gets a reference integration test or no port attachment until it has a real
   async producer.
6. Emit capability diagnostics identifying direct EventPort versus legacy flush.
   Facade exposes real-time only when direct capability exists; otherwise it
   explicitly reports legacy behavior according to its released contract.

Phase-1 acceptance: an idle WebView native callback reaches the existing
ext-event facade tap without another command; no drainWindowEvents call was
necessary for migrated D19 events; old extension fixtures still load; closure,
overflow, and identity tests pass.

### Phase 2: retire only the applicable 16 ms poll

1. Map every POLLED_WINDOW_EVENTS member to a typed push event or retain a
   deliberately separate request/reply mechanism. Do not silently drop
   permission-manager behavior.
2. Migrate focus/blur/visible/style and Darwin reopen activity tracking to
   EventPort. Make subscriptions control native producer work as current D19
   subscriptions do.
3. Delete DrainWindowEvents, native window_events, facade listener-count timer,
   and polling tests in one compatibility decision. Keep
   drainPermissionMessages until a reviewed bidirectional replacement exists.
4. Measure idle native drain commands at zero with a shown retained window,
   separately from page/compositor work, on macOS and Windows.

Phase-2 acceptance: no setInterval(..., 16) remains for legacy window-event
delivery; native callback to facade event works after idle; app-reopen selects
latest retained app-mode window; capability/disconnect behavior remains truthful
on both supported targets.

## Crate Ownership and Compile-Time Budgets

Phase-1 ownership is explicit:

- crates/opentray-spec/src/ext.rs owns ExtEventClassV1, ExtEventRouteV1,
  ExtEventInputV1, ExtEventPortV1, the attach symbol constant, and the two
  port result codes. It owns only C-compatible declarations and serde-neutral
  primitives.
- crates/opentray-bin/src/event_hub.rs (new) owns EventHub, SourceKey/phase, bounded
  queues, coalescing, metrics, and RuntimeWake adapters. It does not enter
  opentray-core.
- crates/opentray-bin/src/dynamic_extension.rs owns optional-symbol resolution and
  passing the immutable port at init/load time.
- crates/opentray-bin/src/extension_events.rs owns source-bound routing into the
  existing ext-event frame.
- crates/opentray-ext-webview and every future ext-* own their native producer
  classification and call the generic port; no ext-specific branch is added to
  opentray-core.

All phase-1 budgets are compile-time constants in
crates/opentray-bin/src/event_hub.rs; there is no environment or consumer config:

Constant | Value | Reason
--- | --- | ---
EVENT_SOURCE_MAX_RECORDS | 128 | Bounds one extension's callback burst while allowing normal navigation/focus churn.
EVENT_SOURCE_MAX_BYTES | 256 KiB | Caps retained JSON memory per loaded source below a single large payload batch.
EVENT_HUB_MAX_RECORDS | 1024 | Leaves room for multiple ext-* sources without allowing unbounded process growth.
EVENT_HUB_MAX_BYTES | 2 MiB | Caps aggregate ingress memory independently of record count.
EVENT_HUB_MAX_SOURCES | 4096 | Bounds permanently retained phase-1 source generations because revoked states are not reclaimed.
EVENT_DRAIN_MAX_RECORDS | 64 | Keeps one broker-loop wake bounded so tray/UI work remains responsive.
EVENT_DRAIN_MAX_BYTES | 128 KiB | Pairs with the record quantum to bound JSON routing work per wake.
EVENT_DATA_MAX_BYTES | 64 KiB | Rejects pathological one-event payloads while covering ordinary extension envelopes.
EVENT_COALESCE_KEY_MAX_BYTES | 128 | Makes Latest-key memory and comparison bounded.

The numbers are starting release constants, not tuning knobs; changing them is a
code/spec review because the value affects memory, fairness, and drop behavior.

## Normative WebView Event Class Table

Kind / phase | Class | Key and overflow rule | Reason
--- | --- | --- | ---
urlChange | Latest | per source + webviewId + url; replace pending item; query getUrl(value,seq) repairs gaps | Intermediate navigations may coalesce; final URL must converge.
titleChange | Latest | per source + webviewId + title; same query/resync rule | Title is current metadata, not an audit log.
focused | Edge | per source + webviewId; every gained/lost edge is retained or `BACKPRESSURE`; no query replay | The existing Rust/TS contract explicitly emits gained and lost focus edges and provides no focused query. Silently replacing an edge would change the D19 contract.
geometryChange | Edge | per source + webviewId; every changed projection is retained or `BACKPRESSURE`; no query replay | D23 explicitly treats the projection as an edge event and the current cache is change-detection only, not a `(value, seq)` snapshot query.
loadState.started | Edge | each navigation start is retained; backpressure is returned, never silently dropped | Consumers use it to enter loading state and it is a lifecycle transition.
loadState.finished | Edge | terminal success is retained; backpressure is returned, never silently dropped | A finished transition must not disappear.
loadState.failed | Edge | terminal failure is retained; backpressure is returned, never silently dropped | Failure is actionable and must remain observable.
loadState.progress | BestEffort | submit progress observations as separate records; drop newest with a metric and return `EXT_OK`; the navigation phase remains an independent Edge | The public D24 contract calls progress best-effort; Windows cannot report it and macOS throttles it.
telemetry / diagnostic | BestEffort | drop newest with metric and EXT_OK | Explicitly non-authoritative.

The class is selected by the WebView native producer before `try_submit`; it is
not inferred from the generic wire `kind`. The native producer submits the
initial `started` phase as one Edge record (even if it knows an initial progress
value), then submits later progress observations as separate BestEffort records
with the same wire kind and `started` phase. `finished` and `failed` are Edge.
There is no
focused or geometry query/resync route in this release, so their Edge
classification is deliberate. A future contract may add a query and change a
state to Latest only with a new extension contract fingerprint.



### Deterministic EventHub suite

- source binding: extension cannot forge app/ext/session; valid route to removed
  or foreign tray is dropped with source-tagged diagnostic;
- PENDING records never escape before LoadExt ACK; failed load discards them;
- per-source FIFO and multi-thread linearization; no cross-source total-order
  assertion;
- Latest replacement, sequence-gap/resync fixture, Edge BACKPRESSURE,
  BestEffort metrics, per-source/global caps, round-robin fairness;
- wake coalescing: N submits yield bounded wake calls; drain races cannot strand
  records; drain budgets re-wake until empty;
- session-close race: submit concurrent with revoke; each result is accepted and
  delivered before close or is PORT_CLOSED/discarded, never post-close and
  never another session;
- reload generation: old port event cannot route under new same-name mount;
- phase-1 reload: old instance Drop/deinit/library drop leaves a revoked,
  process-lifetime EventPortState; stale submit returns PORT_CLOSED; no detach
  or lease test is claimed until the later unload protocol; include a stale
  call with an invalid `ExtBytes` pointer to prove the closed fast path does
  not dereference payload memory;
- malformed UTF-8/JSON/oversize route/data and optional-symbol absence,
  unsupported, and malformed-port cases.

Use a fake RuntimeWake and deterministic scheduler. Do not prove races with
sleeps or native GUI servers.

### Integration and platform evidence

- Dynamic ABI fixtures: E0 legacy, E1 EventPort, absent optional symbol,
  attach-fails, bad port version/size, source-limit rejection,
  manifest/ABI mismatch, reload; verify structured `take_error` categories.
- Broker transport: ext-event goes only to owner; disconnect revocation precedes
  queued async write. Re-run existing router ownership cases with EventHub.
- macOS: real retained WebView navigation/title/focus callback while Node sends
  no command; event appears on facade tap; capture broker/extension identities.
- Windows: equivalent real WebView2 STA run plus named-pipe transport; callback
  does not touch UI from pipe pump/producer thread. Keep unit limitations
  separate from native proof.
- Linux: deterministic EventHub and broker-loop integration. Do not claim native
  KSNI acceptance until a real KSNI runtime exists.
- Regression: old ext-webview/badge fixtures load per matrix; legacy
  drainWindowEvents remains until phase 2.

## AGENTS.md Law Draft

Dynamic Extension EventPort Law

An extension may report a host event outside command dispatch only through the
generic Extension EventPort. The port is bound by the broker to one
(sessionId, appId, instance generation); extensions submit only a tray route
and extension-defined JSON data. They must never retain or call ExtHostContext
outside the FFI invocation that received it.

In phase 1 the host owns the port state until broker process exit. The immutable
port has no retain/release or detach operation. The broker changes a source to
REVOKED before session cleanup, instance deinit, reload, or shutdown; later
submits return `PORT_CLOSED` and never mutate a queue. There is no phase-1
unload or force-dlclose protocol. A future reclaimable unload must add a new
optional symbol family and a new contract fingerprint rather than reinterpret
this law. Shutdown may discard queued events; it must not claim flush.

EventPort ingress is bounded and non-blocking with respect to native UI and
transport I/O. Extension contracts classify events as latest-state,
edge/backpressured, or explicit best-effort and provide query/sequence recovery
where state events may coalesce. No extension may infer global ordering across
sources. Host wakeup is platform-owned (EventLoopProxy or equivalent); no
extension ABI exposes AppKit, Win32, CFRunLoop, eventfd, or broker internals.

opentray-core remains product-neutral. EventPort/DLL ownership and native-loop
adapters live in broker composition; ext-event remains the one Node-facing
extension push frame. A legacy 16 ms event-drain loop may be removed only after
its exact event family has a subscribed native EventPort producer and
macOS/Windows idle-path evidence.

## Principal Risks

1. Phase-1 state must never be reclaimed early. If an implementation frees
   revoked EventPortState or changes process-lifetime allocation into ordinary
   Arc drop, a stale producer gets use-after-free. Add a test that submits from
   an old instance after reload and assert PORT_CLOSED. Reclaim/lease/detach
   belongs to the later unload protocol; the source-generation cap prevents
   permanent state from growing without bound in the meantime.
2. Backpressure can corrupt user-visible truth. A bounded queue that drops
   urlChange leaves an address bar stale forever. Latest plus sequence-gap query
   recovery must ship with D19 migration.
3. Compatibility can silently fake real-time behavior. ABI 3 is exact today,
   but optional port permits E1 on an old host. Facade capability reporting and
   contract fingerprints must distinguish EventPort from legacy next-command
   flushing; a manifest check alone is not proof.
4. A failed platform wake can strand accepted records. The wake adapter must
   preserve the pending bit, record the failure, and drive revocation/shutdown
   handling instead of returning success with no delivery path.
5. The no-reclamation choice creates operational source exhaustion rather than
   memory unsafety: 4096 generations is finite, but a hot reload loop can hit
   it. Surface `event_port_source_limit` and require broker replacement; do not
   silently recycle a `port_data` address.
6. The generic class field can be abused as a reliability escape hatch. Require
   each extension's class table and recovery contract in its manifest fingerprint
   and test that WebView phases use the frozen table.

## Final Verdict

Proposal B is architecturally right only after the ownership, fairness, and
semantic corrections above. Accept all three requested phase-1 reductions:
no retain/release, no detach, and compile-time budgets. B'' remains safe because
the host EventPortState is process-lifetime, ext -> host only, and phase 1 has
no reclaimable unload path. Do not adopt A, C, or D for the shared ext-* law.

This round is design-only: no product source was modified and no cargo build or
runtime acceptance is claimed. The cited checkout anchors are the evidence
base; implementation must earn the deterministic and platform gates above.
