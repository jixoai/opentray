## MODIFIED Requirements

### Requirement: Create SHALL be fully non-interactive

`create-opentray create [target-dir]` SHALL create a v1 application without opening a browser, launching a prompt, or running any command. It SHALL accept either a complete v1 input document or explicit options that compile into v1 desired state. Explicit options SHALL include app identity/name, application and tray icon sources, exact command argv/cwd/env OR a single `--url` application source, package manager, icon smoothing, developer mode, window/shell options, and relevant apply controls.

The command SHALL support an argv delimiter so the executable and every subsequent argument arrive as exact vector elements. It SHALL require explicit `appId` and `appName` when no complete config, derivable source, or enrichment supplies them; under `--url` the identity SHALL default to Core's URL identity derivation. Icon sources MAY be local files, HTTP(S) URLs, or Data URLs and SHALL use Core normalization. `--url` SHALL be mutually exclusive with `--exec`, `--arg`, `--cwd`, and `--env`; combining them SHALL fail validation before any plan.

Under `--url`, creation SHALL by default fetch the address once and adopt the page `<title>` as the default `appName` and the best-ranked favicon (through the shared scrape pipeline: ranked candidates, ICO frame extraction, SVG densification) as the default app icon source. Defaults fill ONLY absent fields, in the precedence explicit flag > `--config` document > scraped preset > address-text derivation; `appId` NEVER derives from page content. Scraping SHALL be bounded per request, silently fall back (hostname-derived name + glyph icon) on any failure, and be disabled by an explicit `--no-scrape` for offline or privacy-sensitive use. `--dry-run` SHALL apply the same enrichment so the printed plan matches what apply would commit. Command-mode creation SHALL NOT scrape anything (the command is never run by the CLI).

#### Scenario: Explicit URL icons create without enrichment

- **GIVEN** app name, app id, command vector, HTTP app icon, and HTTP tray icon supplied to `create`
- **WHEN** the command runs non-interactively
- **THEN** it SHALL request a Core plan/apply without invoking title or favicon scraping
- **AND** the committed registration SHALL contain validated local snapshots

#### Scenario: A URL alone creates an application

- **GIVEN** only `--url https://example.com` (no identity, no command flags)
- **WHEN** `create` runs non-interactively
- **THEN** it SHALL derive identity from the URL and plan/apply a URL application
- **AND** the committed config SHALL carry `url` with no command object

#### Scenario: URL and command flags conflict

- **GIVEN** `--url https://example.com` together with `--exec npm`
- **WHEN** `create` compiles flags
- **THEN** it SHALL fail with a typed validation error naming the mutual exclusion
- **AND** no plan or mutation SHALL occur

#### Scenario: Scraped title and favicon become defaults only

- **GIVEN** `--url https://example.com` where the address serves a page titled `Example — News` with a favicon, and no explicit `--app-name`/`--app-icon`
- **WHEN** `create` runs
- **THEN** the committed `appName` SHALL be the page title and the app icon SHALL be a committed snapshot derived from the best-ranked favicon
- **AND** explicit `--app-name`/`--app-icon` SHALL win over both scraped presets and the config document

#### Scenario: Unreachable address falls back silently

- **GIVEN** `--url https://unreachable.invalid` and no explicit identity/icon
- **WHEN** `create` runs
- **THEN** creation SHALL succeed with the address-derived name and the glyph fallback icon
- **AND** `--no-scrape` SHALL produce the same result without any network attempt
