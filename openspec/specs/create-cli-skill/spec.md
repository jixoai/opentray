# create-cli-skill Specification

## Purpose
TBD - created by archiving change add-create-opentray-cli. Update Purpose after archive.
## Requirements
### Requirement: Create-opentray SHALL ship one English AI Skill

The repository SHALL own a standards-compliant, English-only AI Skill for create-opentray under the public consumer-skill tree and SHALL include it in the published `create-opentray` package. The Skill SHALL explain the OpenTray model, how create-opentray maps a command into a registered application, the v1 configuration and registry layout, the yargs command tree, safe lifecycle behavior, and platform limitations. It SHALL NOT contain repository-maintainer workflows or WebUI-localized human-help content.

#### Scenario: Packed package contains the Skill

- **GIVEN** the release tarball produced by a normal package build
- **WHEN** its files are inspected
- **THEN** `SKILL.md` and every referenced Skill file SHALL be present under one stable packaged root
- **AND** no source-workspace-only maintainer instructions SHALL be required

### Requirement: Skill commands SHALL expose stable logical paths

`create-opentray skill` without a verb SHALL read `SKILL.md`. `skill list [path]` SHALL list logical relative file entries beneath the packaged Skill root. `skill read <path>` SHALL write the exact UTF-8 content of one file, including `skill read SKILL.md`. List output SHALL normalize separators to `/` on every platform and SHALL hide localization/build-storage details.

#### Scenario: Default skill entry reads SKILL.md

- **GIVEN** the installed create-opentray package
- **WHEN** `npx create-opentray skill` runs
- **THEN** stdout SHALL contain the packaged English `SKILL.md`

### Requirement: Skill access SHALL be read-only and contained

Skill list/read SHALL reject absolute paths, traversal, NUL bytes, link escapes, and reads outside the packaged Skill root. The commands SHALL never modify Skill files. Missing paths and directory/file mismatches SHALL return clear typed errors and non-zero status.

#### Scenario: Traversal cannot read package files

- **GIVEN** `skill read ../package.json`
- **WHEN** the requested path is resolved
- **THEN** the command SHALL reject it before filesystem read
- **AND** stdout SHALL not contain package metadata

### Requirement: CLI Skill SHALL remain independent from WebUI localization

Skill commands SHALL always expose the canonical English AI-facing tree. They SHALL NOT infer locale, accept a locale switch, or read the WebUI's human-oriented translations. WebUI help may share factual identifiers, but it SHALL be packaged and governed by the WebUI Change.

#### Scenario: Arabic system locale does not change Skill output

- **GIVEN** a host whose system locale is Arabic
- **WHEN** `skill read SKILL.md` runs
- **THEN** it SHALL return the same canonical English content as every other locale

