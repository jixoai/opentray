## ADDED Requirements

### Requirement: Public SDK guidance SHALL surface the current protocol line selector

The public `opentray` package documentation and examples SHALL explain that `latest` is convenience-only and that `stable-A-B` / `alpha-A-B` are protocol-line compatibility selectors. The guidance SHALL tell consumers and AI agents that when the line advances, the install selector for the affected package closure must move with it. The guidance SHALL not imply that a protocol-line tag is extension-specific.

#### Scenario: Consumer docs show line-pinned install

- **GIVEN** a developer reads the public install guidance
- **WHEN** they want a compatibility-pinned install
- **THEN** the guidance shows a protocol-line selector such as `stable-1-2`
- **AND** it does not suggest a tag such as `stable-webview-1-2`.

#### Scenario: Docs distinguish convenience from compatibility

- **GIVEN** a developer wants the newest package without line pinning
- **WHEN** they read the install guidance
- **THEN** the docs may still mention `latest`
- **AND** they clearly label it as convenience rather than a compatibility contract.
