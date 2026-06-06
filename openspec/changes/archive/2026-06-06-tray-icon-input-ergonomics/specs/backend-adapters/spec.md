## ADDED Requirements

### Requirement: Native tray-icon backend SHALL normalize supported icon sources before tray materialization

The native `tray-icon` backend SHALL support `rgba` icon assets for visible tray items and SHALL also accept `encoded` and `file` icon sources that can be decoded to PNG RGBA. The backend SHALL normalize supported sources into RGBA before native tray materialization. Missing files, unreadable files, and undecodable inputs SHALL return typed backend failures. Human-visible examples SHALL use a deliberate nonblank RGBA icon rather than a transparent or one-pixel placeholder.

#### Scenario: Encoded or file icon is normalized before native tray creation

- **GIVEN** a tray projection contains a decodable `encoded` or `file` PNG icon source
- **WHEN** the native `tray-icon` backend applies the projection
- **THEN** it decodes the PNG into RGBA before native tray materialization
- **AND** it does not require the client SDK to perform PNG decoding first.

#### Scenario: Missing or undecodable icon source fails honestly

- **GIVEN** a tray projection contains a missing file or undecodable PNG data
- **WHEN** the native `tray-icon` backend applies the projection
- **THEN** it returns a typed backend failure with an actionable icon-source code
- **AND** it does not silently substitute a blank icon.
