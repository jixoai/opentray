# create-process-observation Specification

## Purpose
TBD - created by archiving change unify-create-opentray-core. Update Purpose after archive.
## Requirements
### Requirement: Preview execution SHALL be a headless Core capability

Core SHALL own command preview execution, bounded terminal/output transport, input/resize where supported, process-tree teardown, and run-state events without depending on browser APIs. Adapters MAY choose whether to expose preview, but SHALL not reimplement its process semantics.

#### Scenario: Adapter disconnect does not orphan preview

- **GIVEN** a preview process owned by a Core session
- **WHEN** its adapter disconnects or explicitly stops the session
- **THEN** Core SHALL terminate the verified preview process tree
- **AND** release its observation resources

### Requirement: Port discovery SHALL use process ownership and HTTP verification

Core SHALL discover services by comparing listener state, attributing candidate ports to the preview command's process tree, and verifying that candidates answer HTTP. macOS/Linux and Windows listener enumeration SHALL preserve equivalent ownership semantics. Foreign listeners, including browser DevTools sockets, SHALL not become application services.

#### Scenario: Foreign port is excluded

- **GIVEN** a preview process and an unrelated process that begins listening during the same interval
- **WHEN** Core scans and verifies listeners
- **THEN** only ports owned by the preview process tree and answering HTTP SHALL be reported

### Requirement: HTTP metadata scraping SHALL remain optional enrichment

Core MAY fetch a verified service to extract title and icon candidates, download and validate images, rank candidates, and derive suggestions. This capability SHALL be headless and adapter-neutral. A caller that does not invoke enrichment SHALL be able to create a complete application from explicit v1 input. Scraping SHALL never overwrite an explicitly supplied application name or icon source.

#### Scenario: Explicit identity wins over scrape

- **GIVEN** explicit `appName` and icon resources plus a service that advertises different metadata
- **WHEN** an adapter invokes enrichment
- **THEN** Core MAY return suggestions
- **BUT** normalized desired state SHALL preserve the explicit values

### Requirement: Process observation SHALL expose platform gaps honestly

Core SHALL use platform-capability results rather than browser or UI special cases. If interactive PTY, listener ownership, link creation, or another observation capability is unavailable, Core SHALL report typed unavailable/unsupported status and MAY use only a behaviorally explicit degraded path. It SHALL not claim Windows parity from POSIX-only evidence.

#### Scenario: Windows tests are not Windows acceptance

- **GIVEN** cross-platform parsers and mocked Windows commands pass on a non-Windows host
- **WHEN** the Change is reviewed for completion
- **THEN** that evidence SHALL be labeled preparatory
- **AND** native Windows agent evidence SHALL remain required for release acceptance

