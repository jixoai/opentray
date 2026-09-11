//! Message-channel wire protocol (D9–D11, D20): targeted connections
//! without port transfer, an explicit observable lifecycle state machine,
//! exact queue bounds, and the frozen seven-frame inventory. Errors use the
//! typed-code envelope `{ error: { code, message } }` and the owner tuple
//! rides every frame envelope. The TypeScript mirror lives in
//! `packages/spec/src/channel.ts`; both sides are pinned to the same wire
//! shapes by the shared fixtures in `fixtures/frames/channel-frames.json`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::canonical_json::canonical_json;
use crate::webview::{OrchestrationErrorCode, WebviewErrorBody, WebviewId, WebviewOwnerTuple};

/// Opaque channel id, unique within its session scope.
pub type ChannelId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelEndpointSide {
    Creator,
    Target,
}

/// Listed channel states; `destroyed` channels are never listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelState {
    Open,
    Closed,
}

/// Channel close reasons (D11/D20). `queue_overflow` also appears in the
/// error-code registry as the `channel.post` failure code — it is the one
/// value shared across the reason and error namespaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelCloseReason {
    Explicit,
    Destroyed,
    PeerWebviewDestroyed,
    WindowDestroyed,
    SessionClosed,
    DocumentNavigated,
    QueueOverflow,
}

pub const CHANNEL_CLOSE_REASONS: &[&str] = &[
    "explicit",
    "destroyed",
    "peer_webview_destroyed",
    "window_destroyed",
    "session_closed",
    "document_navigated",
    "queue_overflow",
];

impl ChannelCloseReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Destroyed => "destroyed",
            Self::PeerWebviewDestroyed => "peer_webview_destroyed",
            Self::WindowDestroyed => "window_destroyed",
            Self::SessionClosed => "session_closed",
            Self::DocumentNavigated => "document_navigated",
            Self::QueueOverflow => "queue_overflow",
        }
    }
}

/// Exact queue bounds (D20): boundary values themselves are legal.
pub const CHANNEL_QUEUE_MAX_MESSAGES: usize = 1000;

/// 1 MiB cumulative payload byte budget per port queue.
pub const CHANNEL_QUEUE_MAX_BYTES: usize = 1_048_576;

/// Per-session closed-tombstone retention bound (oldest evicted).
pub const CHANNEL_TOMBSTONE_LIMIT: usize = 32;

/// Error codes `channel.create` may legitimately return (frozen registry).
pub const CHANNEL_CREATE_ERROR_CODES: &[OrchestrationErrorCode] = &[
    OrchestrationErrorCode::UnknownView,
    OrchestrationErrorCode::BridgeRequired,
    OrchestrationErrorCode::SessionScope,
];

/// Error codes `channel.post` may legitimately return (frozen registry).
pub const CHANNEL_POST_ERROR_CODES: &[OrchestrationErrorCode] = &[
    OrchestrationErrorCode::NotOpen,
    OrchestrationErrorCode::InvalidPayload,
    OrchestrationErrorCode::PayloadTooLarge,
    OrchestrationErrorCode::QueueOverflow,
];

/// Host-facing endpoint descriptor: side plus the peer (webview id or `"host"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEndpointDescriptor {
    pub side: ChannelEndpointSide,
    pub peer: ChannelPeer,
}

/// The other end of a channel: a webview id or the host creator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChannelPeer {
    Host(HostLiteral),
    Webview(WebviewId),
}

impl ChannelPeer {
    pub fn host() -> Self {
        Self::Host(HostLiteral)
    }

    pub fn webview(id: impl Into<String>) -> Self {
        Self::Webview(id.into())
    }
}

/// The literal `"host"` peer value, distinct from any webview id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostLiteral;

impl Serialize for HostLiteral {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str("host")
    }
}

impl<'de> Deserialize<'de> for HostLiteral {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct HostVisitor;

        impl serde::de::Visitor<'_> for HostVisitor {
            type Value = HostLiteral;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("the literal string \"host\"")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                if value == "host" {
                    Ok(HostLiteral)
                } else {
                    Err(E::custom(format!("expected \"host\", got {value:?}")))
                }
            }
        }

        deserializer.deserialize_str(HostVisitor)
    }
}

/// One listed channel (live, or a closed tombstone with its close reason).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListEntry {
    pub channel_id: ChannelId,
    pub state: ChannelState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<ChannelCloseReason>,
    pub endpoints: Vec<ChannelEndpointDescriptor>,
}

/// Page-facing endpoint descriptor: side label only, never a peer webview id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageChannelEndpointDescriptor {
    pub side: ChannelEndpointSide,
}

/// Page-visible list entry: peers are reduced to side labels (D20
/// visibility — page peers see the side label only; peer webview ids are
/// never exposed to pages).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageChannelListEntry {
    pub channel_id: ChannelId,
    pub state: ChannelState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<ChannelCloseReason>,
    pub endpoints: Vec<PageChannelEndpointDescriptor>,
}

impl ChannelListEntry {
    /// Projects this entry to the page-visible shape.
    pub fn to_page_visible(&self) -> PageChannelListEntry {
        PageChannelListEntry {
            channel_id: self.channel_id.clone(),
            state: self.state,
            reason: self.reason,
            endpoints: self
                .endpoints
                .iter()
                .map(|endpoint| PageChannelEndpointDescriptor {
                    side: endpoint.side,
                })
                .collect(),
        }
    }
}

/// The frozen wire inventory: create / post / close / destroy / list plus
/// the `created` / `closed` push events (seven frame families), their
/// result frames, and the typed error envelope. The owner tuple rides every
/// frame envelope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all_fields = "camelCase",
    rename_all = "kebab-case"
)]
pub enum ChannelFrame {
    #[serde(rename = "channel.create")]
    Create {
        owner: WebviewOwnerTuple,
        target: WebviewId,
    },
    #[serde(rename = "channel.create-result")]
    CreateResult {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    #[serde(rename = "channel.post")]
    Post {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
        payload: Value,
    },
    #[serde(rename = "channel.post-result")]
    PostResult {
        owner: WebviewOwnerTuple,
    },
    #[serde(rename = "channel.close")]
    Close {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    #[serde(rename = "channel.close-result")]
    CloseResult {
        owner: WebviewOwnerTuple,
    },
    #[serde(rename = "channel.destroy")]
    Destroy {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    #[serde(rename = "channel.destroy-result")]
    DestroyResult {
        owner: WebviewOwnerTuple,
    },
    #[serde(rename = "channel.list")]
    List {
        owner: WebviewOwnerTuple,
    },
    #[serde(rename = "channel.list-result")]
    ListResult {
        owner: WebviewOwnerTuple,
        channels: Vec<ChannelListEntry>,
    },
    #[serde(rename = "channel.error")]
    Error {
        owner: WebviewOwnerTuple,
        error: WebviewErrorBody,
    },
    /// Push event to the target webview.
    #[serde(rename = "channel.created")]
    Created {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
    },
    /// Push event to each endpoint that has not yet observed a closure.
    #[serde(rename = "channel.closed")]
    Closed {
        owner: WebviewOwnerTuple,
        channel_id: ChannelId,
        reason: ChannelCloseReason,
    },
}

impl ChannelFrame {
    /// Wire tag of this frame (the `type` discriminant).
    pub fn frame_type(&self) -> &'static str {
        match self {
            Self::Create { .. } => "channel.create",
            Self::CreateResult { .. } => "channel.create-result",
            Self::Post { .. } => "channel.post",
            Self::PostResult { .. } => "channel.post-result",
            Self::Close { .. } => "channel.close",
            Self::CloseResult { .. } => "channel.close-result",
            Self::Destroy { .. } => "channel.destroy",
            Self::DestroyResult { .. } => "channel.destroy-result",
            Self::List { .. } => "channel.list",
            Self::ListResult { .. } => "channel.list-result",
            Self::Error { .. } => "channel.error",
            Self::Created { .. } => "channel.created",
            Self::Closed { .. } => "channel.closed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelPayloadError {
    /// The value is outside the RFC 8785 domain (NaN/Infinity-equivalents).
    InvalidPayload,
}

impl std::fmt::Display for ChannelPayloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPayload => f.write_str(
                "value is outside the RFC 8785 domain; post it as a string or JSON value",
            ),
        }
    }
}

impl std::error::Error for ChannelPayloadError {}

/// Byte accounting for the queue budget (D20): a string payload counts its
/// raw UTF-8 bytes; any other JSON payload counts the UTF-8 bytes of its
/// RFC 8785 serialization. Values outside the RFC 8785 domain reject —
/// callers map that rejection to the typed error `invalid_payload`.
pub fn channel_payload_byte_count(payload: &Value) -> Result<usize, ChannelPayloadError> {
    if let Value::String(text) = payload {
        return Ok(text.len());
    }
    canonical_json(payload)
        .map(|text| text.len())
        .map_err(|_| ChannelPayloadError::InvalidPayload)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::json;

    use super::*;

    fn owner() -> WebviewOwnerTuple {
        WebviewOwnerTuple {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
        }
    }

    fn build_frame(name: &str) -> Option<ChannelFrame> {
        let owner = owner();
        let frame = match name {
            "channel.create request" => ChannelFrame::Create {
                owner,
                target: "toolbar".to_string(),
            },
            "channel.create result" => ChannelFrame::CreateResult {
                owner,
                channel_id: "ch-7f3a".to_string(),
            },
            "channel.post with string payload" => ChannelFrame::Post {
                owner,
                channel_id: "ch-7f3a".to_string(),
                payload: Value::String("reload".to_string()),
            },
            "channel.post with json payload" => ChannelFrame::Post {
                owner,
                channel_id: "ch-7f3a".to_string(),
                payload: json!({ "type": "navigate", "url": "https://example.com" }),
            },
            "channel.post result ok" => ChannelFrame::PostResult { owner },
            "channel.close request" => ChannelFrame::Close {
                owner,
                channel_id: "ch-7f3a".to_string(),
            },
            "channel.close result ok (idempotent)" => ChannelFrame::CloseResult { owner },
            "channel.destroy request" => ChannelFrame::Destroy {
                owner,
                channel_id: "ch-7f3a".to_string(),
            },
            "channel.destroy result ok (idempotent)" => ChannelFrame::DestroyResult { owner },
            "channel.list request" => ChannelFrame::List { owner },
            "channel.list result with live channel and closed tombstone" => {
                ChannelFrame::ListResult {
                    owner,
                    channels: vec![
                        ChannelListEntry {
                            channel_id: "ch-7f3a".to_string(),
                            state: ChannelState::Open,
                            reason: None,
                            endpoints: vec![
                                ChannelEndpointDescriptor {
                                    side: ChannelEndpointSide::Creator,
                                    peer: ChannelPeer::host(),
                                },
                                ChannelEndpointDescriptor {
                                    side: ChannelEndpointSide::Target,
                                    peer: ChannelPeer::webview("toolbar"),
                                },
                            ],
                        },
                        ChannelListEntry {
                            channel_id: "ch-2b91".to_string(),
                            state: ChannelState::Closed,
                            reason: Some(ChannelCloseReason::Explicit),
                            endpoints: vec![
                                ChannelEndpointDescriptor {
                                    side: ChannelEndpointSide::Creator,
                                    peer: ChannelPeer::webview("toolbar"),
                                },
                                ChannelEndpointDescriptor {
                                    side: ChannelEndpointSide::Target,
                                    peer: ChannelPeer::webview("content"),
                                },
                            ],
                        },
                    ],
                }
            }
            "channel.error typed envelope" => ChannelFrame::Error {
                owner,
                error: WebviewErrorBody {
                    code: OrchestrationErrorCode::QueueOverflow,
                    message: "queue byte budget exceeded".to_string(),
                },
            },
            "channel.created push event to the target webview" => ChannelFrame::Created {
                owner,
                channel_id: "ch-7f3a".to_string(),
            },
            "channel.closed push event with reason" => ChannelFrame::Closed {
                owner,
                channel_id: "ch-7f3a".to_string(),
                reason: ChannelCloseReason::PeerWebviewDestroyed,
            },
            _ => return None,
        };
        Some(frame)
    }

    /// Shared wire-shape suite: `packages/spec/src/channel.test.ts` builds
    /// the same frames from the same fixture names, so the TypeScript and
    /// Rust DTOs are pinned to identical field-level wire shapes for the
    /// seven-frame inventory plus result frames and the typed error envelope.
    #[test]
    fn channel_frames_match_shared_fixtures() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/frames/channel-frames.json");
        let raw = fs::read_to_string(&path).expect("read channel fixtures");
        let entries: Vec<Value> = serde_json::from_str(&raw).expect("parse channel fixtures");
        assert!(entries.len() >= 14, "expected at least 14 channel fixtures");
        for entry in entries {
            let name = entry["name"].as_str().expect("fixture name");
            let frame = entry["frame"].clone();
            let built = build_frame(name).unwrap_or_else(|| panic!("missing builder for {name}"));
            let value = serde_json::to_value(&built).expect("serialize channel frame");
            assert_eq!(
                crate::webview::test_support::normalize_numbers(&value),
                crate::webview::test_support::normalize_numbers(&frame),
                "wire shape mismatch for {name}"
            );
            // Round-trip: fixture JSON decodes into an equal frame.
            let decoded: ChannelFrame =
                serde_json::from_value(frame).unwrap_or_else(|error| panic!("decode {name}: {error}"));
            assert_eq!(decoded, built, "round-trip mismatch for {name}");
        }
    }

    #[test]
    fn registries_and_bounds_freeze_their_values() {
        assert_eq!(
            CHANNEL_CLOSE_REASONS,
            &[
                "explicit",
                "destroyed",
                "peer_webview_destroyed",
                "window_destroyed",
                "session_closed",
                "document_navigated",
                "queue_overflow",
            ]
        );
        assert_eq!(CHANNEL_QUEUE_MAX_MESSAGES, 1000);
        assert_eq!(CHANNEL_QUEUE_MAX_BYTES, 1_048_576);
        assert_eq!(CHANNEL_TOMBSTONE_LIMIT, 32);
        assert_eq!(
            CHANNEL_CREATE_ERROR_CODES,
            &[
                OrchestrationErrorCode::UnknownView,
                OrchestrationErrorCode::BridgeRequired,
                OrchestrationErrorCode::SessionScope,
            ]
        );
        assert_eq!(
            CHANNEL_POST_ERROR_CODES,
            &[
                OrchestrationErrorCode::NotOpen,
                OrchestrationErrorCode::InvalidPayload,
                OrchestrationErrorCode::PayloadTooLarge,
                OrchestrationErrorCode::QueueOverflow,
            ]
        );
        // queue_overflow lives in both the reason and post-error namespaces.
        assert_eq!(
            serde_json::to_value(ChannelCloseReason::QueueOverflow).unwrap(),
            json!("queue_overflow")
        );
        assert_eq!(
            serde_json::to_value(OrchestrationErrorCode::QueueOverflow).unwrap(),
            json!("queue_overflow")
        );
    }

    #[test]
    fn payload_accounting_matches_the_canonical_codec() {
        // String payloads count raw UTF-8 bytes.
        assert_eq!(channel_payload_byte_count(&json!("héllo")), Ok(6));
        assert_eq!(channel_payload_byte_count(&json!("reload")), Ok(6));
        assert_eq!(channel_payload_byte_count(&json!("😀")), Ok(4));
        // JSON payloads count RFC 8785 bytes (key order canonicalized).
        assert_eq!(
            channel_payload_byte_count(&json!({ "type": "navigate", "url": "https://example.com" })),
            Ok("{\"type\":\"navigate\",\"url\":\"https://example.com\"}".len())
        );
        assert_eq!(
            channel_payload_byte_count(&json!({ "b": 1, "a": ["x", 2] })),
            Ok("{\"a\":[\"x\",2],\"b\":1}".len())
        );
    }

    #[test]
    fn page_visibility_projection_hides_peer_webview_ids() {
        let entry = ChannelListEntry {
            channel_id: "ch-7f3a".to_string(),
            state: ChannelState::Closed,
            reason: Some(ChannelCloseReason::PeerWebviewDestroyed),
            endpoints: vec![
                ChannelEndpointDescriptor {
                    side: ChannelEndpointSide::Creator,
                    peer: ChannelPeer::host(),
                },
                ChannelEndpointDescriptor {
                    side: ChannelEndpointSide::Target,
                    peer: ChannelPeer::webview("toolbar"),
                },
            ],
        };
        let page_entry = entry.to_page_visible();
        assert_eq!(
            serde_json::to_value(&page_entry).unwrap(),
            json!({
                "channelId": "ch-7f3a",
                "state": "closed",
                "reason": "peer_webview_destroyed",
                "endpoints": [{ "side": "creator" }, { "side": "target" }]
            })
        );
        assert!(
            !serde_json::to_string(&page_entry).unwrap().contains("toolbar"),
            "peer webview ids must not leak to page-visible entries"
        );
    }

    #[test]
    fn frame_tags_and_peer_literals_spell_exactly() {
        assert_eq!(
            build_frame("channel.close request").unwrap().frame_type(),
            "channel.close"
        );
        assert_eq!(
            build_frame("channel.created push event to the target webview")
                .unwrap()
                .frame_type(),
            "channel.created"
        );
        // The host peer serializes as the literal "host", a webview id stays
        // a bare string, and both decode back.
        let host = serde_json::to_value(ChannelPeer::host()).unwrap();
        let webview = serde_json::to_value(ChannelPeer::webview("toolbar")).unwrap();
        assert_eq!(host, json!("host"));
        assert_eq!(webview, json!("toolbar"));
        assert_eq!(
            serde_json::from_value::<ChannelPeer>(json!("host")).unwrap(),
            ChannelPeer::host()
        );
        assert_eq!(
            serde_json::from_value::<ChannelPeer>(json!("toolbar")).unwrap(),
            ChannelPeer::webview("toolbar")
        );
    }
}
