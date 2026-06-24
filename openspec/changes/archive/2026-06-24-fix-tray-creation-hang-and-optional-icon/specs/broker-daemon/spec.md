# broker-daemon Specification Delta

## ADDED Requirements

### Requirement: Broker daemon SHALL correlate malformed frame errors to their request

When a client frame fails deserialization, the broker SHALL extract the `requestId` from the raw frame line (when present) and include it in the resulting error response, so the originating client request can reject instead of hanging. An error that cannot be correlated to a `requestId` SHALL still be emitted; the client treats such an error as fatal to all pending requests.

#### Scenario: Malformed create-tray frame rejects the originating request

- **GIVEN** a client sends a `create-tray` frame that omits a required field or is otherwise invalid
- **WHEN** the broker fails to deserialize the frame
- **THEN** the broker emits an error frame carrying the same `requestId` as the malformed request
- **AND** the client rejects the pending `createTray` promise with that error.

#### Scenario: Frame without requestId cannot wedge a client promise

- **GIVEN** a client sends a malformed frame that carries no `requestId`
- **WHEN** the broker fails to deserialize the frame
- **THEN** the broker emits an error frame with no `requestId`
- **AND** the client rejects every pending request rather than hanging indefinitely.
