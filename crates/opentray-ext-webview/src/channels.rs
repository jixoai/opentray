//! Message-channel registry and lifecycle state machine
//! (add-webview-orchestration D9-D11, D20).
//!
//! Pure, platform-neutral bookkeeping for one window session's channels:
//! `created -> open -> closed(reason) -> destroyed` with the exact queue
//! bounds, the per-session tombstone LRU, the single-observation `onClose`
//! cardinality, and the host-side flush outbox. Nothing here touches
//! AppKit, Win32, or wry; the platform runtime embeds
//! `Rc<RefCell<SessionChannels>>` into its window bridge and delivers the
//! returned [`ChannelPush`] effects through its own page transports.
//!
//! Wire shapes, bounds constants, and the canonical byte counter come from
//! `opentray-spec::channel` (frozen by the shared fixtures) — this module
//! consumes them and never redefines them. Authority validation beyond
//! the owner tuple (does the target webview exist? is its bridge policy
//! enabled?) happens in the platform layer before `create` is called, so
//! the typed errors `unknown_view` and `bridge_required` for creation are
//! produced there; this module owns every post-creation transition.
//!
//! Host-side observation (the "flush with the command response" delivery
//! ruled sufficient for v1, tasks 3.3b/3.5) rides `host_outbox`: closed
//! observations use the frozen `channel.closed` push frame, drained
//! host-port messages use the internal `channel.message` delivery envelope
//! (the frozen seven-frame inventory has no host message frame by design —
//! it governs the page wire; the TS facade batch owns consumption).

use std::collections::VecDeque;

use serde_json::{json, Value};

use opentray_spec::channel::{
    channel_payload_byte_count, ChannelCloseReason, ChannelEndpointDescriptor,
    ChannelEndpointSide, ChannelFrame, ChannelId, ChannelListEntry, ChannelPeer, ChannelState,
    PageChannelListEntry, CHANNEL_QUEUE_MAX_BYTES, CHANNEL_QUEUE_MAX_MESSAGES,
    CHANNEL_TOMBSTONE_LIMIT,
};
use opentray_spec::webview::{OrchestrationErrorCode, WebviewId, WebviewOwnerTuple};

use crate::orchestration::{OrchestrationError, WindowOwner};

/// The five command frames of the frozen inventory (results and pushes are
/// not commands). Parsed from `ChannelFrame` in the extension command
/// surface; the owner tuple rides every variant.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ChannelRequest {
    Create {
        owner: WebviewOwnerTuple,
        target: WebviewId,
    },
    Post {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
        payload: Value,
    },
    Close {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    Destroy {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    List {
        owner: WebviewOwnerTuple,
    },
}

impl ChannelRequest {
    /// Owner tuple of the command (present on every variant).
    pub(crate) fn owner(&self) -> &WebviewOwnerTuple {
        match self {
            Self::Create { owner, .. }
            | Self::Post { owner, .. }
            | Self::Close { owner, .. }
            | Self::Destroy { owner, .. }
            | Self::List { owner } => owner,
        }
    }

    /// Maps a decoded wire frame to a command. Result and push frames are
    /// not commands; `None` rejects at parse time.
    pub(crate) fn from_frame(frame: ChannelFrame) -> Option<Self> {
        match frame {
            ChannelFrame::Create { owner, target } => Some(Self::Create { owner, target }),
            ChannelFrame::Post {
                owner,
                channel_id,
                payload,
            } => Some(Self::Post {
                owner,
                channel_id,
                payload,
            }),
            ChannelFrame::Close { owner, channel_id } => Some(Self::Close { owner, channel_id }),
            ChannelFrame::Destroy { owner, channel_id } => {
                Some(Self::Destroy { owner, channel_id })
            }
            ChannelFrame::List { owner } => Some(Self::List { owner }),
            _ => None,
        }
    }
}

/// Who is sending a post/close/destroy: the host facade or one bridged
/// page (identified by its webview id, supplied by the ipc transport).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChannelSender<'a> {
    Host,
    Page(&'a str),
}

impl ChannelSender<'_> {
    fn view_id(&self) -> Option<&str> {
        match self {
            Self::Host => None,
            Self::Page(view) => Some(view),
        }
    }
}

/// A pending push the platform layer must deliver to a page bridge.
/// Host observations never appear here — they ride the host outbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChannelPush {
    /// `channel.created` for the target webview's page bridge.
    Created {
        target_view: WebviewId,
        channel_id: ChannelId,
    },
    /// `channel.closed` for one page endpoint that has not observed a
    /// closure yet.
    Closed {
        view: WebviewId,
        channel_id: ChannelId,
        reason: ChannelCloseReason,
    },
}

/// Successful `post` receipt: the receiving endpoint (side and peer), so
/// the integration drains exactly that port.
#[derive(Debug)]
pub(crate) struct PostReceipt {
    pub(crate) endpoint: ChannelEndpointSide,
    pub(crate) recipient: ChannelPeer,
}

/// A `post` rejection. `queue_overflow` still owes both endpoints their
/// one `onClose` — its closure pushes ride along (`pushes` is empty for
/// every other error).
#[derive(Debug)]
pub(crate) struct ChannelPostError {
    pub(crate) error: OrchestrationError,
    pub(crate) pushes: Vec<ChannelPush>,
}

/// One port queue with the exact D20 bounds. The boundary values
/// themselves are legal; the message that would exceed either bound never
/// enters the queue.
#[derive(Debug, Default)]
struct PortQueue {
    entries: VecDeque<Value>,
    total_bytes: usize,
}

impl PortQueue {
    fn len(&self) -> usize {
        self.entries.len()
    }

    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Debug)]
struct ChannelRecord {
    id: ChannelId,
    /// `destroyed` records are removed from the registry entirely, so this
    /// only distinguishes live from tombstoned channels.
    open: bool,
    close_reason: Option<ChannelCloseReason>,
    creator: ChannelPeer,
    target: ChannelPeer,
    creator_queue: PortQueue,
    target_queue: PortQueue,
    /// Single-observation cardinality (D20): set once at the first closure
    /// transition; every later transition is storage-only and silent.
    creator_notified: bool,
    target_notified: bool,
}

/// Channel state for one window session, scoped by the D18 owner tuple.
/// The session identity is the channel scope `(appId, trayId, sessionId)`;
/// unattributed legacy windows reject every channel command with
/// `session_scope` because the frozen frames require a session id.
#[derive(Debug)]
pub(crate) struct SessionChannels {
    owner: WindowOwner,
    records: Vec<ChannelRecord>,
    /// Closed-channel tombstones in close order (back = newest).
    tombstones: VecDeque<ChannelId>,
    id_seed: u64,
    next_id: u64,
    /// Host-bound flush events in order. Closed observations use the
    /// frozen `channel.closed` frame; drained host-port messages use the
    /// internal `channel.message` envelope.
    host_outbox: VecDeque<Value>,
}

impl SessionChannels {
    pub(crate) fn new(owner: WindowOwner) -> Self {
        // Opaque per-session id prefix so channel ids are not guessable
        // across sessions and never reused after a session ends.
        let id_seed = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0))
            ^ (std::process::id() as u64).rotate_left(32);
        Self {
            owner,
            records: Vec::new(),
            tombstones: VecDeque::new(),
            id_seed,
            next_id: 1,
            host_outbox: VecDeque::new(),
        }
    }

    /// Session owner tuple; `None` for unattributed legacy windows.
    pub(crate) fn owner_tuple(&self) -> Option<WebviewOwnerTuple> {
        self.owner.owner_tuple()
    }

    fn ensure_scope(&self, owner: &WebviewOwnerTuple) -> Result<(), OrchestrationError> {
        if self.owner.app_id != owner.app_id
            || self.owner.tray_id != owner.tray_id
            || self.owner.session_id.as_deref() != Some(owner.session_id.as_str())
        {
            return Err(OrchestrationError::new(
                OrchestrationErrorCode::SessionScope,
                format!(
                    "channel owner (app {}, tray {}, session {}) does not address this window \
                     session (app {}, tray {}, session {})",
                    owner.app_id,
                    owner.tray_id,
                    owner.session_id,
                    self.owner.app_id,
                    self.owner.tray_id,
                    self.owner.session_id.as_deref().unwrap_or("<unattributed>"),
                ),
            ));
        }
        Ok(())
    }

    fn allocate_id(&mut self) -> ChannelId {
        let id = format!("ch-{:x}-{:x}", self.id_seed, self.next_id);
        self.next_id += 1;
        id
    }

    /// Registers one open channel. Target existence and bridge-policy
    /// validation happened in the platform layer (`unknown_view` /
    /// `bridge_required`); this call trusts a resolved target.
    pub(crate) fn create(
        &mut self,
        owner: &WebviewOwnerTuple,
        creator: ChannelPeer,
        target: WebviewId,
    ) -> Result<(ChannelId, ChannelPush), OrchestrationError> {
        self.ensure_scope(owner)?;
        let channel_id = self.allocate_id();
        self.records.push(ChannelRecord {
            id: channel_id.clone(),
            open: true,
            close_reason: None,
            creator,
            target: ChannelPeer::webview(target.clone()),
            creator_queue: PortQueue::default(),
            target_queue: PortQueue::default(),
            creator_notified: false,
            target_notified: false,
        });
        Ok((
            channel_id.clone(),
            ChannelPush::Created {
                target_view: target,
                channel_id,
            },
        ))
    }

    /// Enqueues one payload from `sender` for the opposite endpoint.
    ///
    /// Sender authority: the host posts through its creator endpoint (a
    /// page-created channel gives the host no endpoint — `not_open`); a
    /// page posts through whichever endpoint it participates on, and a
    /// non-participating page also gets `not_open`. Bounds: a single
    /// payload over 1 MiB rejects `payload_too_large` without closing;
    /// exceeding either cumulative bound on enqueue returns
    /// `queue_overflow` and closes the channel (both endpoints observe one
    /// `onClose` through the returned pushes/outbox).
    pub(crate) fn post(
        &mut self,
        owner: &WebviewOwnerTuple,
        sender: ChannelSender<'_>,
        channel_id: &str,
        payload: Value,
    ) -> Result<PostReceipt, ChannelPostError> {
        let scoped = |error| ChannelPostError {
            error,
            pushes: Vec::new(),
        };
        self.ensure_scope(owner).map_err(scoped)?;
        let index = self.record_index(channel_id).ok_or_else(|| {
            scoped(OrchestrationError::new(
                OrchestrationErrorCode::UnknownView,
                format!("channel {channel_id} is not registered in this session"),
            ))
        })?;
        if !self.records[index].open {
            return Err(scoped(OrchestrationError::new(
                OrchestrationErrorCode::NotOpen,
                format!("channel {channel_id} is closed"),
            )));
        }
        let byte_count = channel_payload_byte_count(&payload).map_err(|_| {
            scoped(OrchestrationError::new(
                OrchestrationErrorCode::InvalidPayload,
                "value is outside the RFC 8785 domain; post it as a string or JSON value",
            ))
        })?;
        if byte_count > CHANNEL_QUEUE_MAX_BYTES {
            return Err(scoped(OrchestrationError::new(
                OrchestrationErrorCode::PayloadTooLarge,
                format!(
                    "payload of {byte_count} bytes exceeds the {CHANNEL_QUEUE_MAX_BYTES}-byte \
                     single-message limit",
                ),
            )));
        }
        let sending_side = self.resolving_sender_side(index, sender).map_err(scoped)?;
        let overflow = {
            let record = &self.records[index];
            let queue = match sending_side {
                ChannelEndpointSide::Creator => &record.target_queue,
                ChannelEndpointSide::Target => &record.creator_queue,
            };
            queue.len() >= CHANNEL_QUEUE_MAX_MESSAGES
                || queue.total_bytes + byte_count > CHANNEL_QUEUE_MAX_BYTES
        };
        if overflow {
            let pushes = self.close_record(index, ChannelCloseReason::QueueOverflow, None);
            return Err(ChannelPostError {
                error: OrchestrationError::new(
                    OrchestrationErrorCode::QueueOverflow,
                    format!(
                        "channel {channel_id} exceeded its port queue bounds and was closed"
                    ),
                ),
                pushes,
            });
        }
        let record = &mut self.records[index];
        let (endpoint, recipient) = match sending_side {
            ChannelEndpointSide::Creator => (ChannelEndpointSide::Target, record.target.clone()),
            ChannelEndpointSide::Target => (ChannelEndpointSide::Creator, record.creator.clone()),
        };
        let queue = match sending_side {
            ChannelEndpointSide::Creator => &mut record.target_queue,
            ChannelEndpointSide::Target => &mut record.creator_queue,
        };
        queue.entries.push_back(payload);
        queue.total_bytes += byte_count;
        Ok(PostReceipt { endpoint, recipient })
    }

    /// Resolves which endpoint `sender` speaks for. `Err(not_open)` when
    /// the sender holds no endpoint on the channel.
    fn resolving_sender_side(
        &self,
        index: usize,
        sender: ChannelSender<'_>,
    ) -> Result<ChannelEndpointSide, OrchestrationError> {
        let record = &self.records[index];
        let not_open = || {
            OrchestrationError::new(
                OrchestrationErrorCode::NotOpen,
                "the sender holds no endpoint on this channel",
            )
        };
        match sender.view_id() {
            None => {
                // The host facade posts through its creator endpoint.
                if matches!(record.creator, ChannelPeer::Host(_)) {
                    Ok(ChannelEndpointSide::Creator)
                } else {
                    Err(not_open())
                }
            }
            Some(view) => {
                if matches!(&record.creator, ChannelPeer::Webview(id) if id == view) {
                    Ok(ChannelEndpointSide::Creator)
                } else if matches!(&record.target, ChannelPeer::Webview(id) if id == view) {
                    Ok(ChannelEndpointSide::Target)
                } else {
                    Err(not_open())
                }
            }
        }
    }

    /// Graceful close (`closed(explicit)`, tombstone retained). Closing an
    /// already-closed channel is an idempotent success with no effects.
    /// Page senders must participate in the channel; the host may close
    /// any channel of its session (same authority split as `destroy`).
    pub(crate) fn close(
        &mut self,
        owner: &WebviewOwnerTuple,
        sender: ChannelSender<'_>,
        channel_id: &str,
    ) -> Result<Vec<ChannelPush>, OrchestrationError> {
        self.ensure_scope(owner)?;
        let Some(index) = self.record_index(channel_id) else {
            return Err(OrchestrationError::new(
                OrchestrationErrorCode::UnknownView,
                format!("channel {channel_id} is not registered in this session"),
            ));
        };
        if let Some(view) = sender.view_id() {
            let participates =
                matches!(&self.records[index].creator, ChannelPeer::Webview(id) if id == view)
                    || matches!(&self.records[index].target, ChannelPeer::Webview(id) if id == view);
            if !participates {
                return Err(OrchestrationError::new(
                    OrchestrationErrorCode::NotOpen,
                    "the sender holds no endpoint on this channel",
                ));
            }
        }
        if !self.records[index].open {
            return Ok(Vec::new());
        }
        Ok(self.close_record(index, ChannelCloseReason::Explicit, None))
    }

    /// Destroy (idempotent, repeat calls are no-ops): on an open channel
    /// it removes the state immediately and both endpoints' single
    /// `onClose` carries `destroyed`; on a closed tombstone it removes the
    /// tombstone silently. Page senders must participate in the channel;
    /// the host may destroy any channel of its session (it owns the
    /// session lifecycle and reaps tombstones through
    /// `destroyMessageChannel`).
    pub(crate) fn destroy(
        &mut self,
        owner: &WebviewOwnerTuple,
        sender: ChannelSender<'_>,
        channel_id: &str,
    ) -> Result<Vec<ChannelPush>, OrchestrationError> {
        self.ensure_scope(owner)?;
        let Some(index) = self.record_index(channel_id) else {
            // Idempotent no-op: destroying an unknown (already fully
            // removed) channel succeeds silently.
            return Ok(Vec::new());
        };
        if let Some(view) = sender.view_id() {
            let participates =
                matches!(&self.records[index].creator, ChannelPeer::Webview(id) if id == view)
                    || matches!(&self.records[index].target, ChannelPeer::Webview(id) if id == view);
            if !participates {
                return Err(OrchestrationError::new(
                    OrchestrationErrorCode::NotOpen,
                    "the sender holds no endpoint on this channel",
                ));
            }
        }
        let pushes = if self.records[index].open {
            self.close_record(index, ChannelCloseReason::Destroyed, None)
        } else {
            Vec::new()
        };
        self.remove_record(index);
        Ok(pushes)
    }

    /// Host-visible list: every open channel plus closed tombstones with
    /// their close reasons and full endpoint descriptors.
    pub(crate) fn list_for_host(
        &self,
        owner: &WebviewOwnerTuple,
    ) -> Result<Vec<ChannelListEntry>, OrchestrationError> {
        self.ensure_scope(owner)?;
        Ok(self
            .records
            .iter()
            .map(|record| ChannelListEntry {
                channel_id: record.id.clone(),
                state: if record.open {
                    ChannelState::Open
                } else {
                    ChannelState::Closed
                },
                reason: record.close_reason,
                endpoints: vec![
                    ChannelEndpointDescriptor {
                        side: ChannelEndpointSide::Creator,
                        peer: record.creator.clone(),
                    },
                    ChannelEndpointDescriptor {
                        side: ChannelEndpointSide::Target,
                        peer: record.target.clone(),
                    },
                ],
            })
            .collect())
    }

    /// Page-visible list (D20 visibility): only the channels the view
    /// participates in, with peers reduced to side labels.
    pub(crate) fn list_for_page(
        &self,
        owner: &WebviewOwnerTuple,
        view_id: &str,
    ) -> Result<Vec<PageChannelListEntry>, OrchestrationError> {
        let entries = self.list_for_host(owner)?;
        Ok(entries
            .into_iter()
            .filter(|entry| {
                entry.endpoints.iter().any(|endpoint| {
                    matches!(&endpoint.peer, ChannelPeer::Webview(id) if id == view_id)
                })
            })
            .map(|entry| entry.to_page_visible())
            .collect())
    }

    /// Closes every open channel with an endpoint on `view_id`
    /// (`peer_webview_destroyed` from `destroy-webview`, or
    /// `document_navigated` from a page navigation — the caller picks the
    /// reason). Pushes addressed to `view_id` itself are skipped: the
    /// page is going away (or its document is being replaced), so its
    /// observation cannot land; the other endpoint still observes. Closed
    /// tombstones are untouched — teardown entrances never rewrite
    /// history.
    pub(crate) fn close_channels_of_webview(
        &mut self,
        view_id: &str,
        reason: ChannelCloseReason,
    ) -> Vec<ChannelPush> {
        let mut pushes = Vec::new();
        let mut index = 0;
        while index < self.records.len() {
            let record = &self.records[index];
            let participates =
                matches!(&record.creator, ChannelPeer::Webview(id) if id == view_id)
                    || matches!(&record.target, ChannelPeer::Webview(id) if id == view_id);
            if participates && record.open {
                pushes.extend(self.close_record(index, reason, Some(view_id)));
            } else {
                index += 1;
            }
        }
        pushes
    }

    /// Session/window teardown (`window_destroyed`, `session_closed`):
    /// closes every open channel — endpoints not yet notified observe
    /// once — then removes all channel state. These are destroy
    /// entrances: nothing survives as a tombstone.
    pub(crate) fn close_all(&mut self, reason: ChannelCloseReason) -> Vec<ChannelPush> {
        let mut pushes = Vec::new();
        // The bound is re-checked every iteration: each close_record may evict
        // an expired tombstone, which REMOVES a record and shifts the vec —
        // a fixed 0..len range would index past the shrunk vec once more
        // than 32 channels close here (final-review B1: broker-crash panic
        // at 34 open channels).
        let mut index = 0;
        while index < self.records.len() {
            if self.records[index].open {
                pushes.extend(self.close_record(index, reason, None));
                // The record at `index` is now closed but may have shifted;
                // do not advance — re-examine the index against the vec.
            } else {
                index += 1;
            }
        }
        self.records.clear();
        self.tombstones.clear();
        pushes
    }

    /// FIFO drain of one port (the delivery path). Returns `None` for an
    /// unknown channel.
    pub(crate) fn drain_port(
        &mut self,
        owner: &WebviewOwnerTuple,
        channel_id: &str,
        endpoint: ChannelEndpointSide,
    ) -> Result<Option<Vec<Value>>, OrchestrationError> {
        self.ensure_scope(owner)?;
        let Some(index) = self.record_index(channel_id) else {
            return Ok(None);
        };
        let queue = match endpoint {
            ChannelEndpointSide::Creator => &mut self.records[index].creator_queue,
            ChannelEndpointSide::Target => &mut self.records[index].target_queue,
        };
        Ok(Some(queue.entries.drain(..).collect()))
    }

    /// Drains every port whose receiving endpoint is `view_id` (used when
    /// the page finished loading and can consume pushes). FIFO per port.
    pub(crate) fn drain_view_ports(&mut self, view_id: &str) -> Vec<(ChannelId, Value)> {
        let mut drained = Vec::new();
        for record in &mut self.records {
            let id = record.id.clone();
            let endpoints = [
                (
                    matches!(&record.creator, ChannelPeer::Webview(id) if id == view_id),
                    &mut record.creator_queue,
                ),
                (
                    matches!(&record.target, ChannelPeer::Webview(id) if id == view_id),
                    &mut record.target_queue,
                ),
            ];
            for (owns, queue) in endpoints {
                if owns {
                    for payload in queue.entries.drain(..) {
                        drained.push((id.clone(), payload));
                    }
                    queue.total_bytes = 0;
                }
            }
        }
        drained
    }

    /// Moves host-port messages into the host outbox and drains it. The
    /// returned values self-carry the owner tuple; the extension write
    /// path routes each one under its owning tray scope.
    pub(crate) fn drain_host_events(&mut self) -> Vec<(WebviewOwnerTuple, Value)> {
        let Some(owner) = self.owner_tuple() else {
            self.host_outbox.clear();
            return Vec::new();
        };
        for record in &mut self.records {
            if matches!(record.creator, ChannelPeer::Host(_)) && !record.creator_queue.is_empty() {
                for payload in record.creator_queue.entries.drain(..) {
                    self.host_outbox.push_back(json!({
                        "type": "channel.message",
                        "owner": owner,
                        "channelId": record.id,
                        "payload": payload,
                    }));
                }
                record.creator_queue.total_bytes = 0;
            }
        }
        self.host_outbox
            .drain(..)
            .map(|value| (owner.clone(), value))
            .collect()
    }

    /// Returns undeliverable host events to the FRONT of the host outbox,
    /// oldest first, preserving FIFO for the command-response flush path.
    /// harden-lifecycle-ownership (2026-09-15): the EventPort push producer
    /// calls this for records it cannot guarantee (oversized payload, retry
    /// overflow, revoked/absent port) — the authoritative store stays this
    /// outbox, so a retained record is delivered by the next command
    /// response exactly as the v1 flush ruling delivered it.
    pub(crate) fn requeue_host_events_front(&mut self, events: Vec<Value>) {
        for value in events.into_iter().rev() {
            self.host_outbox.push_front(value);
        }
    }

    /// Test/introspection accessor: pending message count of one port.
    #[cfg(test)]
    pub(crate) fn port_len(
        &self,
        channel_id: &str,
        endpoint: ChannelEndpointSide,
    ) -> Option<usize> {
        let record = self.records.iter().find(|record| record.id == channel_id)?;
        Some(match endpoint {
            ChannelEndpointSide::Creator => record.creator_queue.len(),
            ChannelEndpointSide::Target => record.target_queue.len(),
        })
    }

    /// Test/introspection accessor: cumulative byte accounting of one port.
    #[cfg(test)]
    pub(crate) fn port_bytes(
        &self,
        channel_id: &str,
        endpoint: ChannelEndpointSide,
    ) -> Option<usize> {
        let record = self.records.iter().find(|record| record.id == channel_id)?;
        Some(match endpoint {
            ChannelEndpointSide::Creator => record.creator_queue.total_bytes,
            ChannelEndpointSide::Target => record.target_queue.total_bytes,
        })
    }

    /// Test/introspection accessor: retained tombstone count.
    #[cfg(test)]
    pub(crate) fn tombstone_count(&self) -> usize {
        self.tombstones.len()
    }

    fn record_index(&self, channel_id: &str) -> Option<usize> {
        self.records.iter().position(|record| record.id == channel_id)
    }

    /// Applies the first closure transition to an open channel: records
    /// the tombstone, marks both endpoints as having spent their one
    /// observation, emits page pushes (skipping `skip_view`), and records
    /// the host observation in the outbox. Queues are cleared — pending
    /// messages are never replayed after closure. Tombstone capacity is
    /// enforced oldest-first.
    fn close_record(
        &mut self,
        index: usize,
        reason: ChannelCloseReason,
        skip_view: Option<&str>,
    ) -> Vec<ChannelPush> {
        let owner = self.owner_tuple();
        let record = &mut self.records[index];
        debug_assert!(record.open, "close_record expects an open channel");
        record.open = false;
        record.close_reason = Some(reason);
        record.creator_queue = PortQueue::default();
        record.target_queue = PortQueue::default();
        let mut pushes = Vec::new();
        if !record.creator_notified {
            record.creator_notified = true;
            match &record.creator {
                ChannelPeer::Webview(view) => {
                    if Some(view.as_str()) != skip_view {
                        pushes.push(ChannelPush::Closed {
                            view: view.clone(),
                            channel_id: record.id.clone(),
                            reason,
                        });
                    }
                }
                ChannelPeer::Host(_) => {
                    if let Some(owner) = owner.clone() {
                        self.host_outbox.push_back(
                            serde_json::to_value(ChannelFrame::Closed {
                                owner,
                                channel_id: record.id.clone(),
                                reason,
                            })
                            .unwrap_or(Value::Null),
                        );
                    }
                }
            }
        }
        if !record.target_notified {
            record.target_notified = true;
            if let ChannelPeer::Webview(view) = &record.target {
                if Some(view.as_str()) != skip_view {
                    pushes.push(ChannelPush::Closed {
                        view: view.clone(),
                        channel_id: record.id.clone(),
                        reason,
                    });
                }
            }
        }
        // Tombstone capacity: retain the most recently closed 32.
        self.tombstones.push_back(record.id.clone());
        while self.tombstones.len() > CHANNEL_TOMBSTONE_LIMIT {
            if let Some(oldest) = self.tombstones.pop_front() {
                if let Some(index) = self.record_index(&oldest) {
                    self.records.remove(index);
                }
            }
        }
        pushes
    }

    /// Fully removes one record (destroy on open or on tombstone) and its
    /// tombstone entry.
    fn remove_record(&mut self, index: usize) {
        let id = self.records[index].id.clone();
        self.records.remove(index);
        self.tombstones.retain(|tombstone| *tombstone != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn owner_tuple(session: &str) -> WebviewOwnerTuple {
        WebviewOwnerTuple {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
        }
    }

    fn window_owner(session: Option<&str>) -> WindowOwner {
        WindowOwner {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.map(str::to_string),
            window_id: "win-1".to_string(),
        }
    }

    fn registry() -> SessionChannels {
        SessionChannels::new(window_owner(Some("session-1")))
    }

    fn owner() -> WebviewOwnerTuple {
        owner_tuple("session-1")
    }

    fn create_host_channel(
        channels: &mut SessionChannels,
        target: &str,
    ) -> (ChannelId, ChannelPush) {
        channels
            .create(&owner(), ChannelPeer::host(), target.to_string())
            .expect("host-created channel")
    }

    fn create_page_channel(
        channels: &mut SessionChannels,
        creator_view: &str,
        target: &str,
    ) -> (ChannelId, ChannelPush) {
        channels
            .create(
                &owner(),
                ChannelPeer::webview(creator_view),
                target.to_string(),
            )
            .expect("page-created channel")
    }

    #[test]
    fn create_returns_opaque_unique_ids_and_created_push() {
        let mut channels = registry();
        let (first, push) = create_host_channel(&mut channels, "toolbar");
        let (second, _) = create_host_channel(&mut channels, "content");
        assert_ne!(first, second, "channel ids are unique in the session");
        assert!(first.starts_with("ch-"), "channel ids stay opaque");
        assert_eq!(
            push,
            ChannelPush::Created {
                target_view: "toolbar".to_string(),
                channel_id: first.clone(),
            }
        );
        // A fresh registry with a different seed cannot collide.
        let mut other = registry();
        let (third, _) = create_host_channel(&mut other, "toolbar");
        assert_ne!(first, third);
    }

    #[test]
    fn cross_session_and_unattributed_commands_reject_with_zero_partial_state() {
        let mut channels = registry();
        let error = channels
            .create(
                &owner_tuple("session-2"),
                ChannelPeer::host(),
                "toolbar".to_string(),
            )
            .expect_err("cross-session owner tuple must reject");
        assert_eq!(error.code(), OrchestrationErrorCode::SessionScope);
        assert!(channels.list_for_host(&owner()).unwrap().is_empty());

        // Unattributed legacy windows: every command is session_scope
        // (frozen frames require a session id).
        let mut legacy = SessionChannels::new(window_owner(None));
        let error = legacy
            .create(&owner(), ChannelPeer::host(), "toolbar".to_string())
            .expect_err("unattributed window must reject");
        assert_eq!(error.code(), OrchestrationErrorCode::SessionScope);
    }

    #[test]
    fn requeue_host_events_front_preserves_fifo_for_the_response_flush() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");

        // Page→host messages land in the host outbox via drain_host_events.
        for url in ["https://a.test/1", "https://a.test/2", "https://a.test/3"] {
            channels
                .post(&owner(), ChannelSender::Page("toolbar"), &channel_id, json!(url))
                .expect("page post");
        }
        let drained = channels.drain_host_events();
        assert_eq!(drained.len(), 3);

        // The push producer could guarantee only the oldest record: the
        // retained ones return to the FRONT, oldest first, so the unchanged
        // command-response flush still delivers them in FIFO order.
        let retained: Vec<Value> = drained[1..].iter().map(|(_, v)| v.clone()).collect();
        channels.requeue_host_events_front(retained);
        let after = channels.drain_host_events();
        assert_eq!(
            after
                .iter()
                .map(|(_, v)| v["payload"].clone())
                .collect::<Vec<_>>(),
            vec![json!("https://a.test/2"), json!("https://a.test/3")],
            "retained records keep FIFO order at the front of the host outbox"
        );
        assert!(channels.drain_host_events().is_empty());
    }

    #[test]
    fn close_is_explicit_with_a_tombstone_and_destroy_silently_reaps_it() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");

        // close(): both endpoints observe exactly one onClose(explicit),
        // the tombstone stays listed with its reason.
        let pushes = channels
            .close(&owner(), ChannelSender::Host, &channel_id)
            .expect("close");
        assert_eq!(
            pushes,
            vec![ChannelPush::Closed {
                view: "toolbar".to_string(),
                channel_id: channel_id.clone(),
                reason: ChannelCloseReason::Explicit,
            }],
            "the page endpoint observes once; the host observation rides the outbox"
        );
        let host_outbox = channels.drain_host_events();
        assert_eq!(host_outbox.len(), 1, "the host endpoint observes once too");
        assert_eq!(host_outbox[0].1["type"], "channel.closed");
        assert_eq!(host_outbox[0].1["reason"], "explicit");
        let listed = channels.list_for_host(&owner()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].state, ChannelState::Closed);
        assert_eq!(listed[0].reason, Some(ChannelCloseReason::Explicit));

        // destroy() after close: silent tombstone removal, no callbacks.
        let pushes = channels
            .destroy(&owner(), ChannelSender::Host, &channel_id)
            .expect("destroy");
        assert!(pushes.is_empty(), "no second observation");
        assert!(channels.drain_host_events().is_empty());
        assert!(channels.list_for_host(&owner()).unwrap().is_empty());

        // Repeat destroy is a no-op success.
        channels
            .destroy(&owner(), ChannelSender::Host, &channel_id)
            .expect("repeat destroy stays an idempotent success");
    }

    #[test]
    fn destroy_on_an_open_channel_notifies_once_and_vanishes() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        let pushes = channels
            .destroy(&owner(), ChannelSender::Host, &channel_id)
            .expect("destroy");
        assert_eq!(
            pushes,
            vec![ChannelPush::Closed {
                view: "toolbar".to_string(),
                channel_id: channel_id.clone(),
                reason: ChannelCloseReason::Destroyed,
            }]
        );
        assert!(channels.drain_host_events().len() == 1);
        assert!(channels.list_for_host(&owner()).unwrap().is_empty());
    }

    #[test]
    fn posting_on_a_closed_channel_is_not_open_and_never_drops_silently() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        channels.close(&owner(), ChannelSender::Host, &channel_id).expect("close");
        let error = channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("reload"))
            .expect_err("post must reject");
        assert_eq!(error.error.code(), OrchestrationErrorCode::NotOpen);
        assert!(error.pushes.is_empty());
    }

    #[test]
    fn queue_bounds_are_exact_at_both_limits() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");

        // Exactly CHANNEL_QUEUE_MAX_BYTES of string payload is legal.
        let exact: String = "x".repeat(CHANNEL_QUEUE_MAX_BYTES);
        channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!(exact))
            .expect("the exact byte boundary is legal");
        assert_eq!(
            channels
                .port_bytes(&channel_id, ChannelEndpointSide::Target)
                .unwrap(),
            CHANNEL_QUEUE_MAX_BYTES
        );

        // One more single byte returns queue_overflow and closes the
        // channel with both endpoints observing queue_overflow.
        let error = channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("x"))
            .expect_err("one byte over the budget must overflow");
        assert_eq!(error.error.code(), OrchestrationErrorCode::QueueOverflow);
        assert_eq!(
            error.pushes,
            vec![ChannelPush::Closed {
                view: "toolbar".to_string(),
                channel_id: channel_id.clone(),
                reason: ChannelCloseReason::QueueOverflow,
            }]
        );
        let outbox = channels.drain_host_events();
        assert_eq!(outbox.last().unwrap().1["reason"], "queue_overflow");
        let listed = channels.list_for_host(&owner()).unwrap();
        assert_eq!(listed[0].state, ChannelState::Closed);
        assert_eq!(listed[0].reason, Some(ChannelCloseReason::QueueOverflow));
    }

    #[test]
    fn message_count_bound_is_exact_at_one_thousand() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        for index in 0..CHANNEL_QUEUE_MAX_MESSAGES {
            channels
                .post(&owner(), ChannelSender::Host, &channel_id, json!(index))
                .expect("small messages under the count bound enqueue");
        }
        assert_eq!(
            channels
                .port_len(&channel_id, ChannelEndpointSide::Target)
                .unwrap(),
            CHANNEL_QUEUE_MAX_MESSAGES
        );
        let error = channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("1001st"))
            .expect_err("the 1001st message must overflow");
        assert_eq!(error.error.code(), OrchestrationErrorCode::QueueOverflow);
        assert_eq!(error.pushes.len(), 1);
    }

    #[test]
    fn single_oversize_payload_rejects_without_closing() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        let oversize: String = "x".repeat(CHANNEL_QUEUE_MAX_BYTES + 1);
        let error = channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!(oversize))
            .expect_err("single oversize payload");
        assert_eq!(error.error.code(), OrchestrationErrorCode::PayloadTooLarge);
        assert!(error.pushes.is_empty(), "payload_too_large never closes");
        assert!(channels.drain_host_events().is_empty());
        // The channel survives and still works.
        channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("fine"))
            .expect("channel stays open after payload_too_large");
    }

    #[test]
    fn non_canonical_numbers_reject_as_invalid_payload() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        // The RFC 8785 domain boundary: serde_json's `Value` cannot even
        // represent non-finite numbers (construction and parsing both
        // reject), so on the Rust side every representable payload is
        // canonicalizable and the `invalid_payload` mapping in `post` is
        // defense-in-depth for the boundary where non-finite values are
        // constructible (the TS facade, whose encoder rejects them before
        // the wire). Out-of-range literals reject at wire parse time.
        assert!(serde_json::from_str::<Value>("1e400").is_err());
        // JSON payloads count their RFC 8785 bytes, not their input form.
        channels
            .post(
                &owner(),
                ChannelSender::Host,
                &channel_id,
                json!({ "b": 2, "a": 1 }),
            )
            .expect("canonicalizable payload");
        assert_eq!(
            channels
                .port_bytes(&channel_id, ChannelEndpointSide::Target)
                .unwrap(),
            "{\"a\":1,\"b\":2}".len(),
            "key order is canonicalized before accounting"
        );
    }

    #[test]
    fn fifo_delivery_preserves_order_per_port() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        for index in 0..5 {
            channels
                .post(&owner(), ChannelSender::Host, &channel_id, json!(index))
                .expect("enqueue");
        }
        let drained = channels
            .drain_port(&owner(), &channel_id, ChannelEndpointSide::Target)
            .unwrap()
            .expect("port exists");
        assert_eq!(drained, vec![json!(0), json!(1), json!(2), json!(3), json!(4)]);
        // Draining again yields nothing until new messages arrive.
        assert!(
            channels
                .drain_port(&owner(), &channel_id, ChannelEndpointSide::Target)
                .unwrap()
                .unwrap()
                .is_empty()
        );

        // Page-to-host direction lands on the creator (host) port.
        let (page_channel, _) = create_page_channel(&mut channels, "a", "b");
        channels
            .post(&owner(), ChannelSender::Page("b"), &page_channel, json!("to-creator"))
            .expect("page posts through its target endpoint");
        assert_eq!(
            channels
                .port_len(&page_channel, ChannelEndpointSide::Creator)
                .unwrap(),
            1
        );
        assert_eq!(
            channels
                .port_len(&page_channel, ChannelEndpointSide::Target)
                .unwrap(),
            0
        );
    }

    #[test]
    fn sender_authority_blocks_non_participants() {
        let mut channels = registry();
        // Page-created channel: the host holds no endpoint.
        let (page_channel, _) = create_page_channel(&mut channels, "a", "b");
        let error = channels
            .post(&owner(), ChannelSender::Host, &page_channel, json!("no"))
            .expect_err("host cannot post on a page-created channel");
        assert_eq!(error.error.code(), OrchestrationErrorCode::NotOpen);
        // A non-participating page cannot post, close, or destroy.
        let error = channels
            .post(&owner(), ChannelSender::Page("zzz"), &page_channel, json!("no"))
            .expect_err("non-participant page");
        assert_eq!(error.error.code(), OrchestrationErrorCode::NotOpen);
        let error = channels
            .close(&owner(), ChannelSender::Page("zzz"), &page_channel)
            .expect_err("non-participant page close");
        assert_eq!(error.code(), OrchestrationErrorCode::NotOpen);
        let error = channels
            .destroy(&owner(), ChannelSender::Page("zzz"), &page_channel)
            .expect_err("non-participant page destroy");
        assert_eq!(error.code(), OrchestrationErrorCode::NotOpen);
        // Participants keep full rights, and the host may still destroy
        // any channel of its session (tombstone reaping authority).
        channels
            .post(&owner(), ChannelSender::Page("a"), &page_channel, json!("hi"))
            .expect("creator page posts");
        channels
            .destroy(&owner(), ChannelSender::Host, &page_channel)
            .expect("host destroy authority");
    }

    #[test]
    fn tombstones_are_bounded_and_evicted_oldest_first() {
        let mut channels = registry();
        let mut ids = Vec::new();
        for _ in 0..CHANNEL_TOMBSTONE_LIMIT {
            let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
            channels
                .close(&owner(), ChannelSender::Host, &channel_id)
                .expect("close");
            ids.push(channel_id);
        }
        assert_eq!(channels.tombstone_count(), CHANNEL_TOMBSTONE_LIMIT);
        // The 33rd close evicts the oldest tombstone.
        let (newest, _) = create_host_channel(&mut channels, "toolbar");
        channels
            .close(&owner(), ChannelSender::Host, &newest)
            .expect("close");
        assert_eq!(channels.tombstone_count(), CHANNEL_TOMBSTONE_LIMIT);
        let listed = channels.list_for_host(&owner()).unwrap();
        assert_eq!(listed.len(), CHANNEL_TOMBSTONE_LIMIT);
        assert!(
            !listed.iter().any(|entry| entry.channel_id == ids[0]),
            "the oldest tombstone was destroyed"
        );
        assert!(
            listed.iter().any(|entry| entry.channel_id == newest),
            "the newest close is listed with its reason"
        );
    }

    #[test]
    fn page_visibility_lists_only_participating_channels_with_side_labels() {
        let mut channels = registry();
        let (host_to_a, _) = create_host_channel(&mut channels, "a");
        let (a_to_b, _) = create_page_channel(&mut channels, "a", "b");
        let (host_to_b, _) = create_host_channel(&mut channels, "b");
        channels
            .close(&owner(), ChannelSender::Host, &a_to_b)
            .expect("close");

        let host_list = channels.list_for_host(&owner()).unwrap();
        assert_eq!(host_list.len(), 3, "the host sees every channel");
        assert_eq!(host_list[0].endpoints[0].peer, ChannelPeer::host());

        let a_list = channels.list_for_page(&owner(), "a").unwrap();
        assert_eq!(a_list.len(), 2, "page a participates in exactly two");
        for entry in &a_list {
            let serialized = serde_json::to_value(entry).unwrap();
            assert!(
                !serialized["endpoints"].to_string().contains("\"b\""),
                "peer webview ids never leak to page lists: {serialized}"
            );
            // Endpoint descriptors reduce to bare side labels.
            assert_eq!(
                serialized["endpoints"],
                json!([{ "side": "creator" }, { "side": "target" }])
            );
        }
        // The closed page channel keeps its reason in the page view.
        let closed = a_list
            .iter()
            .find(|entry| entry.channel_id == a_to_b)
            .unwrap();
        assert_eq!(closed.state, ChannelState::Closed);
        assert_eq!(closed.reason, Some(ChannelCloseReason::Explicit));

        // Destroyed channels are absent from every list.
        channels
            .destroy(&owner(), ChannelSender::Host, &host_to_a)
            .expect("destroy");
        assert_eq!(channels.list_for_page(&owner(), "a").unwrap().len(), 1);
        assert_eq!(channels.list_for_host(&owner()).unwrap().len(), 2);
        let _ = host_to_b;
    }

    #[test]
    fn peer_webview_destruction_closes_with_reason_and_skips_the_dead_view() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        let (page_channel, _) = create_page_channel(&mut channels, "toolbar", "content");

        let pushes = channels.close_channels_of_webview(
            "toolbar",
            ChannelCloseReason::PeerWebviewDestroyed,
        );
        // toolbar's own observations are skipped (its page is going away):
        // only content's endpoint push survives, and the host observes
        // through the outbox.
        assert_eq!(
            pushes,
            vec![ChannelPush::Closed {
                view: "content".to_string(),
                channel_id: page_channel.clone(),
                reason: ChannelCloseReason::PeerWebviewDestroyed,
            }]
        );
        // The host observed its channel closure through the outbox.
        let outbox = channels.drain_host_events();
        assert!(
            outbox
                .iter()
                .any(|(_, value)| value["channelId"] == *channel_id.as_str()
                    && value["reason"] == "peer_webview_destroyed")
        );
        // A later host post fails not_open instead of dropping silently.
        let error = channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("x"))
            .expect_err("closed channel");
        assert_eq!(error.error.code(), OrchestrationErrorCode::NotOpen);
    }

    #[test]
    fn document_navigation_closes_page_side_channels_without_replaying() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("pending"))
            .expect("enqueue");
        let pushes =
            channels.close_channels_of_webview("toolbar", ChannelCloseReason::DocumentNavigated);
        // The navigating view's own observation is skipped; the only other
        // endpoint is the host, whose observation rides the outbox — so no
        // page pushes survive.
        assert!(pushes.is_empty());
        // Pending messages are dropped, never buffered across navigation.
        assert!(
            channels
                .drain_port(&owner(), &channel_id, ChannelEndpointSide::Target)
                .unwrap()
                .unwrap()
                .is_empty()
        );
        // The host observes the same transition.
        let outbox = channels.drain_host_events();
        assert_eq!(outbox.len(), 1);
        assert_eq!(outbox[0].1["type"], "channel.closed");
        assert_eq!(outbox[0].1["reason"], "document_navigated");
    }

    #[test]
    fn session_close_survives_beyond_tombstone_capacity() {
        // Final-review B1 regression: closing more channels than the
        // tombstone LRU capacity (32) evicts records mid-iteration — a
        // fixed-range loop indexed past the shrunk vec and panicked at 34.
        let mut channels = registry();
        for _ in 0..40 {
            create_host_channel(&mut channels, "toolbar");
        }
        let pushes = channels.close_all(ChannelCloseReason::SessionClosed);
        // Every one of the 40 toolbar endpoints observes exactly once.
        assert_eq!(pushes.len(), 40);
        // Each channel's host observation rode the outbox: 40 events.
        assert_eq!(channels.drain_host_events().len(), 40);
        assert!(channels.list_for_host(&owner()).unwrap().is_empty());
        assert_eq!(channels.tombstone_count(), 0);
    }

    #[test]
    fn session_close_removes_all_channel_state() {
        let mut channels = registry();
        let (open_id, _) = create_host_channel(&mut channels, "toolbar");
        let (closed_id, _) = create_host_channel(&mut channels, "content");
        channels
            .close(&owner(), ChannelSender::Host, &closed_id)
            .expect("close");
        // Drain the explicit close's host observation first so the
        // session-close outbox below is unambiguous.
        assert_eq!(channels.drain_host_events().len(), 1);

        let pushes = channels.close_all(ChannelCloseReason::SessionClosed);
        assert_eq!(
            pushes.len(),
            1,
            "only the open channel emits a page push; the host observations ride the outbox"
        );
        let outbox = channels.drain_host_events();
        assert_eq!(outbox.len(), 1, "open channel's host observation");
        assert_eq!(outbox[0].1["reason"], "session_closed");
        assert!(channels.list_for_host(&owner()).unwrap().is_empty());
        assert_eq!(channels.tombstone_count(), 0);
        // All ids are gone: destroy stays an idempotent no-op.
        channels
            .destroy(&owner(), ChannelSender::Host, &open_id)
            .expect("destroy of removed state is a no-op success");
    }

    #[test]
    fn window_destruction_closes_every_open_channel() {
        let mut channels = registry();
        let (first, _) = create_host_channel(&mut channels, "toolbar");
        let (second, _) = create_page_channel(&mut channels, "a", "b");
        let pushes = channels.close_all(ChannelCloseReason::WindowDestroyed);
        // One page push per page endpoint: toolbar (host-created channel),
        // a and b (page-created channel); the host observation rides the
        // outbox.
        assert_eq!(pushes.len(), 3);
        assert!(pushes
            .iter()
            .all(|push| matches!(push, ChannelPush::Closed { reason: ChannelCloseReason::WindowDestroyed, .. })));
        let outbox = channels.drain_host_events();
        assert!(outbox.iter().any(|(_, value)| value["channelId"] == *first.as_str()));
        let _ = second;
    }

    #[test]
    fn host_flush_drains_host_ports_as_message_envelopes() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        // Page posts land on the host (creator) port.
        channels
            .post(&owner(), ChannelSender::Page("toolbar"), &channel_id, json!({ "type": "navigate" }))
            .expect("page to host post");
        let events = channels.drain_host_events();
        assert_eq!(events.len(), 1);
        let (scope, value) = &events[0];
        assert_eq!(scope.session_id, "session-1");
        assert_eq!(value["type"], "channel.message");
        assert_eq!(value["channelId"], *channel_id.as_str());
        assert_eq!(value["payload"], json!({ "type": "navigate" }));
        assert!(channels.drain_host_events().is_empty(), "drain is exclusive");
    }

    #[test]
    fn view_port_drain_sweeps_every_endpoint_of_that_view() {
        let mut channels = registry();
        let (channel_id, _) = create_host_channel(&mut channels, "toolbar");
        let (page_channel, _) = create_page_channel(&mut channels, "toolbar", "content");
        channels
            .post(&owner(), ChannelSender::Host, &channel_id, json!("one"))
            .expect("host to toolbar");
        channels
            .post(&owner(), ChannelSender::Page("content"), &page_channel, json!("two"))
            .expect("content to toolbar");
        let drained = channels.drain_view_ports("toolbar");
        assert_eq!(drained.len(), 2, "both ports targeting toolbar drain");
        assert!(
            drained
                .iter()
                .any(|(id, payload)| *id == channel_id && payload == &json!("one"))
        );
        assert!(
            drained
                .iter()
                .any(|(id, payload)| *id == page_channel && payload == &json!("two"))
        );
    }
}
