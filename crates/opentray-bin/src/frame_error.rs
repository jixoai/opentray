use opentray_spec::RequestId;

/// Extracts the `requestId` from a raw client frame line so that a
/// deserialization failure can still be correlated with the originating
/// request. Without this, a malformed frame produces an error with no
/// `requestId`, which the client cannot match to its pending promise and so
/// hangs indefinitely (see issue: createTray never resolves).
///
/// Parses only the top-level `requestId` string field via a lightweight JSON
/// value scan; a full typed parse is not attempted because the whole point is
/// that the typed parse already failed.
pub fn extract_request_id(line: &str) -> Option<RequestId> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let request_id = value.get("requestId")?;
    match request_id {
        serde_json::Value::String(request_id) if !request_id.is_empty() => {
            Some(request_id.clone())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::extract_request_id;

    #[test]
    fn extracts_request_id_from_malformed_frame() {
        // A create-tray frame missing the required `icon` field would fail typed
        // deserialization, but its requestId must still be recoverable.
        let line = r#"{"type":"create-tray","requestId":"opentray-3","space":{"spaceId":"s1"},"tray":{"trayId":"t1","title":"t"}}"#;
        assert_eq!(extract_request_id(line), Some("opentray-3".to_string()));
    }

    #[test]
    fn returns_none_when_request_id_absent() {
        let line = r#"{"type":"exit"}"#;
        assert_eq!(extract_request_id(line), None);
    }

    #[test]
    fn returns_none_for_non_string_request_id() {
        let line = r#"{"requestId":42}"#;
        assert_eq!(extract_request_id(line), None);
    }

    #[test]
    fn returns_none_for_completely_invalid_json() {
        let line = "not json at all";
        assert_eq!(extract_request_id(line), None);
    }
}
