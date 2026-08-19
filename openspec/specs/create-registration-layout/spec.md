# create-registration-layout Specification

## Purpose
TBD - created by archiving change unify-create-opentray-core. Update Purpose after archive.
## Requirements
### Requirement: The create registry SHALL have one fixed physical root

Core SHALL discover create-opentray registrations only under the current user's `~/.opentray/create/` directory. A registration SHALL be a physical directory keyed by the encoded immutable `appId`; the registry root and registration directory SHALL NOT be redirected by a product setting or replaced by a registration-level link.

Each registration SHALL have this authority topology:

```text
~/.opentray/create/<encoded-app-id>/
  create-opentray.json
  app/                       # managed directory or directory link/junction
  app-icon.<validated-ext>   # when supplied
  tray-icon.<validated-ext>  # when independently supplied
  ...                        # other Core-owned source resources
```

Tests MAY inject a home-directory seam, but production behavior SHALL resolve the operating-system user home and the fixed registry suffix.

#### Scenario: External payload remains discoverable

- **GIVEN** a registration whose `app/` is a valid directory link to an external target
- **WHEN** Core scans the fixed registry root
- **THEN** it SHALL discover the application from the physical registration directory
- **AND** it SHALL resolve and report both registration and payload paths

### Requirement: Registration resources SHALL use relative stable references

Uploaded files, Data URLs, and fetched HTTP image sources SHALL normalize into validated sibling files inside the registration directory. `create-opentray.json` SHALL reference those resources relative to its own directory and SHALL retain source provenance plus a content hash. An unchanged remote source SHALL use its recorded local snapshot during reapply rather than silently fetching changed bytes.

Core SHALL validate declared image format against bytes before committing the snapshot. Application and tray icons SHALL remain independently reproducible; omission of a tray source MAY explicitly follow the application icon source, but it MUST NOT create a second mutable copy of source truth.

#### Scenario: URL content cannot drift on ordinary edit

- **GIVEN** an app icon originally fetched from an HTTP URL and committed with a local snapshot and hash
- **WHEN** the URL later serves different bytes and the user edits only the application name
- **THEN** Core SHALL reuse the committed snapshot
- **AND** the icon SHALL not change without an explicit source refresh or replacement

### Requirement: External payload links SHALL preserve platform truth

When a caller selects an external payload target, Core SHALL keep the registration directory physical and make only `app/` a directory link. POSIX SHALL use a directory symlink; Windows SHALL use a supported directory-link projection such as a directory junction or symlink and SHALL report a typed unsupported/permission error if it cannot create one. Core SHALL canonicalize and validate the resolved target before apply or purge.

#### Scenario: Windows link creation cannot silently copy

- **GIVEN** an external payload target on Windows
- **WHEN** the platform cannot create the required directory link
- **THEN** Core SHALL fail with an actionable typed result
- **AND** it SHALL NOT copy the external directory into the registration as a fallback

### Requirement: The v1 registry SHALL be an intentional breaking boundary

Core SHALL recognize only physical v1 registration directories containing `create-opentray.json`. It SHALL NOT discover, list, wrap, move, or migrate legacy projects identified only by `opentray.app.json`, `main.mjs`, or earlier scaffold markers.

#### Scenario: Legacy project is outside the v1 registry

- **GIVEN** a directory under `~/.opentray/create/` that contains old generated files but no `create-opentray.json`
- **WHEN** Core lists registrations
- **THEN** it SHALL NOT report that directory as a v1 application
- **AND** it SHALL NOT mutate the directory

