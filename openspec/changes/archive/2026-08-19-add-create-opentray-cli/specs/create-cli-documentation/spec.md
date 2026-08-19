## ADDED Requirements

### Requirement: Public documentation SHALL teach the three adapter surfaces

The create-opentray README SHALL teach the no-argument WebUI compatibility entry, stable `web` command, non-interactive `create`, registry-oriented `app` commands, and AI-facing `skill` commands. Examples SHALL use exact argv delimiters, explicit app identity, explicit icon sources, and v1 paths that match the implemented yargs help. Destructive examples SHALL state force/stop/purge effects and manual Dock/taskbar cleanup.

#### Scenario: README commands match yargs help

- **GIVEN** every command example in the create-opentray README
- **WHEN** it is compared with generated yargs help and parser tests
- **THEN** every command, positional, option, and default SHALL be valid

### Requirement: Product logos SHALL appear on their owned README surfaces

The root OpenTray README SHALL use the supplied `opentray-logo.png` asset, and the create-opentray README SHALL use the supplied `create-opentray-logo.png` asset. Final referenced assets SHALL live in stable publish/repository paths rather than `.agents/` authoring storage, and package staging SHALL include any asset needed by the published README.

#### Scenario: README image links survive packaging

- **GIVEN** repository rendering and the packed create-opentray tarball
- **WHEN** each README image path is resolved in its delivery context
- **THEN** the correct logo SHALL exist and render without relying on `.agents/images`

