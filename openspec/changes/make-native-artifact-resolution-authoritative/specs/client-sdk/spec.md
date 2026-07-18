## ADDED Requirements

### Requirement: TypeScript SDK SHALL resolve official native artifacts from the declaring facade package

An official `TrayExtension` SHALL declare a platform-neutral native artifact descriptor containing the facade package manifest URL, extension contract manifest URL, and supported target-to-platform-package mappings. It SHALL NOT expose a bare package-name `path` as the normal loading contract.

The TypeScript SDK SHALL use the active JavaScript runtime's package resolution from the declaring facade package to resolve exactly one installed platform package manifest. It SHALL derive the native library path from that resolved package and SHALL send the exact path plus expected extension identity to the broker. The Rust broker SHALL NOT reconstruct npm, pnpm, Yarn, Bun, or equivalent package-manager topology for this normal path.

#### Scenario: pnpm nested platform package beats an orphan top-level package

- **GIVEN** a facade package resolves its current platform package inside its pnpm dependency closure
- **AND** the consumer root contains an unmanaged older platform package with the same name
- **WHEN** `tray.extend(...)` first loads the extension
- **THEN** the SDK sends the platform library resolved relative to the facade package
- **AND** it does not send the orphan top-level library.

#### Scenario: Descriptor remains platform neutral

- **GIVEN** an official facade supports multiple operating systems and architectures
- **WHEN** its public module is imported
- **THEN** it declares target package names and artifact-relative paths as data
- **AND** it does not import any platform native package into the facade's public interface.

#### Scenario: Missing target package fails before broker dispatch

- **GIVEN** the current platform is supported by the facade descriptor
- **AND** its platform package cannot be resolved from the facade dependency closure
- **WHEN** the extension is first loaded
- **THEN** the SDK rejects with a typed artifact-resolution error naming the expected package and target
- **AND** it does not ask the broker to search unrelated filesystem roots.

### Requirement: Normal package-manager installation SHALL be the complete consumer setup

Consumers SHALL obtain a coherent broker, facade, and native extension graph after declaring compatible OpenTray packages and running a normal supported package-manager installation. Normal SDK use SHALL NOT require deleting `node_modules`, clearing a package store, manually restarting a broker, or setting `OPENTRAY_BROKER_BIN` / `OPENTRAY_EXT_PATH`.

Explicit artifact environment variables MAY remain diagnostic/source-development location overrides, but they SHALL NOT bypass expected artifact identity validation.

#### Scenario: Clean consumer starts without diagnostic overrides

- **GIVEN** a temporary consumer installs OpenTray and an official extension with a supported package manager
- **WHEN** it starts a tray and loads the extension without OpenTray artifact environment variables
- **THEN** the SDK resolves and loads one coherent artifact closure
- **AND** native commands accepted by the facade are accepted by the loaded extension.

#### Scenario: Explicit override cannot bypass contract identity

- **GIVEN** a consumer sets an explicit extension library override to an incompatible artifact
- **WHEN** the broker validates the library
- **THEN** loading fails with expected and actual identity evidence
- **AND** the incompatible library is never initialized.

## REMOVED Requirements

### Requirement: TrayExtension SHALL expose a bare package path

**Reason**: A bare path forces the Rust broker to guess package-manager topology and carries no artifact identity.

**Migration**: Extension facades declare a native artifact descriptor. Low-level custom extensions supply an exact file artifact plus expected identity.
