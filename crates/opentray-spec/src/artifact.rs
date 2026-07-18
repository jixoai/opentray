//! Generic broker artifact identity shared by SDK lifecycle and native transports.
//!
//! Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
//! 1. Identify one broker executable by package, target, bytes, and build identity.
//! 2. Persist complete caller-scoped readiness evidence without process inspection.

use serde::{Deserialize, Serialize};

use crate::AppId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Operating-system and architecture identity for one broker executable.
pub struct BrokerArtifactTarget {
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Content-derived broker identity shared by readiness metadata and protocol frames.
pub struct BrokerArtifactIdentity {
    pub package_version: String,
    pub target: BrokerArtifactTarget,
    pub executable_hash: String,
    pub build_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Complete caller-scoped readiness evidence written by the native broker.
pub struct BrokerReadyMetadata {
    pub pid: u32,
    pub endpoint: String,
    pub package_version: String,
    pub protocol_version: u32,
    pub app_id: AppId,
    pub app_name: String,
    pub caller_label: String,
    pub executable_path: String,
    pub broker_artifact_identity: BrokerArtifactIdentity,
}
