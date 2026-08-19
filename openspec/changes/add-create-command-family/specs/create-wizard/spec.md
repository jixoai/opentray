## MODIFIED Requirements

### Requirement: Usable Form Without Running The Command

The identity form SHALL be visible and editable from the idle state, before
any command is run. Running the command SHALL be optional: it exists to
preview the command, validate it, and scrape default values. The wizard SHALL
derive placeholder defaults from the submitted command text without spawning
it, using family-aware appId derivation: when the command parses as a known
command family (npm series, go, rust, python, dotnet), the appId SHALL be the
runner-normalized identity segments — pre-option subcommand segments plus the
normalized package identity, with the runner mechanism tokens dropped and the
run binary standing in as identity for the rust family — dot-joined with the
fixed ecosystem tail (`npmjs` / `golang` / `rust` / `python` / `dotnet`), so
the same package run through different runners of one family derives the same
appId; when the command does not parse as a known family (custom commands),
the appId SHALL be the pre-option command segments reversed and dot-joined as
before. The derived display name SHALL use the identity segments without the
ecosystem tail. The target directory SHALL derive from the appId. The form
SHALL include an optional manual service-port input so materialization can
proceed without any discovered service; discovery results SHALL prefill that
input when present. Confirmation SHALL succeed using the manual port when no
service was discovered, and SHALL fail with a clear message only when neither
a discovered service nor a manual port exists.

#### Scenario: Idle form is fully usable

- **GIVEN** the wizard page in the idle state
- **WHEN** the user fills every identity field without ever pressing Run
- **THEN** confirmation and materialization SHALL proceed normally

#### Scenario: Defaults derive without spawning

- **GIVEN** an idle form and a command typed into the command bar
- **WHEN** the command text is primed (debounced input or blur)
- **THEN** the appId and target-dir placeholders SHALL reflect the derivation without any process being spawned

#### Scenario: Family commands derive runner-normalized identity

- **GIVEN** an idle form and the command `npx @deepseek-ai/dsh@latest web`
- **WHEN** the command text is primed
- **THEN** the appId placeholder SHALL be `web.dsh.npmjs`
- **AND** priming `bunx cowsay hello` SHALL derive `hello.cowsay.npmjs` identically to `npx cowsay hello`
- **AND** priming `go run rsc.io/fortune@latest` SHALL derive `fortune.golang`
- **AND** a rust command installing crate `ripgrep` with run binary `rg` SHALL derive `rg.rust`

#### Scenario: Custom commands keep the legacy derivation

- **GIVEN** an idle form and the command `docker compose up -d`
- **WHEN** the command text is primed
- **THEN** the appId placeholder SHALL be `up.compose.docker` exactly as before this change

#### Scenario: Manual port substitutes for discovery

- **GIVEN** no discovered service and a manual port entered in the form
- **WHEN** the user confirms and generates
- **THEN** materialization SHALL use the manual port and the app SHALL point at that service URL

#### Scenario: Missing port fails clearly

- **GIVEN** neither a discovered service nor a manual port
- **WHEN** the user tries to confirm
- **THEN** the wizard SHALL reject with a clear message instead of materializing

## ADDED Requirements

### Requirement: Command Family Authoring SHALL Collapse Into One Input Row

The command card SHALL present command family authoring as a single-row input
group whose total height equals one input: a family selector prefix rendered
with official ecosystem brand marks (vendored SVG, monochrome, theme-safe) and
an edit glyph for the custom family, followed by the command body. In the
custom family the body SHALL be a free-form command input behaving exactly as
the pre-existing string input. In every other family the body SHALL be a
read-only command surface that acts as a button: clicking it SHALL open a form
dialog exposing the family's structured fields (runner where applicable,
package/module/crate/tool identity, version, run arguments; the rust family
additionally the run binary defaulting to the crate name and an install-step
command line shown for reference), with draft semantics — field edits update
an in-dialog preview only, the confirm action serializes the draft back into
the command string, and cancel discards. The form dialog SHALL NOT ship
built-in preset commands. Choosing a non-custom family while argv mode is
active SHALL switch back to string mode; argv mode and the `?edit=` prefill
flow SHALL keep their exact pre-existing behavior.

#### Scenario: Structured dialog writes back the command

- **GIVEN** the npm family selected and the read-only body clicked
- **WHEN** the user fills package `@deepseek-ai/dsh`, version `latest`, arguments `web` and confirms
- **THEN** the command string SHALL become `npx @deepseek-ai/dsh@latest web`
- **AND** canceling the dialog SHALL leave the command string unchanged

#### Scenario: Custom family is unchanged

- **GIVEN** the custom family selected
- **WHEN** the user types a free-form command
- **THEN** input, priming, and derivation SHALL behave exactly as before this change

#### Scenario: Dialog exposes no preset commands

- **GIVEN** any non-custom family's form dialog
- **THEN** it SHALL contain no built-in preset command chips

### Requirement: Family Authoring State SHALL Survive Reloads And Never Execute Installs

The wizard session SHALL keep an explicit family authoring projection
(`commandOptions.family`) as the authority for family, default appId, and env
preset derivation whenever one is present; the command string SHALL remain the
only execution/persistence vector. On page reload, reconnect, or draft restart,
the UI SHALL derive the family selector and the form dialog's initial fields
from that projection — for the rust family the crate and run binary SHALL
survive even though the command string is only the run line. Commands whose
resolved executable (realpath-normalized, case-insensitive, .exe-stripped
basename) is `cargo` and whose argv contains a standalone `install` token SHALL
be refused before any preview is stopped or anything is spawned; this
conservative rule deliberately over-refuses rare non-install cargo invocations
carrying an `install` argument instead of parsing cargo's option grammar, and
SHALL NOT be narrowed back to first-subcommand matching. Runner flag sections
that cannot be mapped without ambiguity (any option outside a conservative
known value-less flag set, such as `deno run --config <path>`) SHALL fall back
verbatim to the custom family instead of reinterpreting the flag's value as
the package name.

#### Scenario: Rust authoring projection survives reload

- **GIVEN** a session holding command `rg --json .` and family projection `{ family: rust, pkg: ripgrep, binary: rg }`
- **WHEN** the page reloads and receives the snapshot
- **THEN** the selector SHALL show the rust family and the dialog SHALL reopen with crate `ripgrep` and binary `rg`
- **AND** the default appId SHALL remain `rg.rust`

#### Scenario: cargo install is never executed

- **GIVEN** any live preview running in the wizard
- **WHEN** the user submits `cargo install ripgrep`
- **THEN** the wizard SHALL reject with guidance toward the rust form without stopping the live preview and without spawning anything

#### Scenario: Value-bearing runner flags stay verbatim

- **GIVEN** the command `deno run --config 'path with spaces' npm:cowsay`
- **WHEN** it is parsed
- **THEN** it SHALL fall back to the custom family preserving the argument tokens exactly, never reinterpreting `path with spaces` as a package name

### Requirement: NPM-Series Env Preset SHALL Be An Explicit Projection Of The User Env List

The user-configured environment entry list SHALL be the single source of truth
for the npm-series env preset (`npm_config_yes=true`, skip the first-run
install confirmation): the preset SHALL take effect only as an explicit entry
in that list, with no implicit injection and no separate enable/disable flag.
The form dialog's preset control SHALL be a live two-way projection of the
list — enabling writes the entry, removing deletes it, and manual edits
outside the dialog are reflected back immediately (the last duplicate entry
wins, matching the spawn/export overlay). The command row indicator icon SHALL
light exactly when the entry exists, disclosing the effective value and its
env-list provenance. Existing env-export acknowledgement law applies unchanged.

#### Scenario: Preset is an explicit entry on run and in the generated app

- **GIVEN** the command `npx @deepseek-ai/dsh@latest web` primed and `npm_config_yes=true` present in the env list
- **WHEN** the user runs it and later confirms generation
- **THEN** the spawned process env SHALL include `npm_config_yes=true`
- **AND** the generated app config command env SHALL include the same entry

#### Scenario: The user env list is the single source of truth

- **GIVEN** an npm-series npx command primed without the entry
- **WHEN** the command runs
- **THEN** no `npm_config_yes` SHALL be injected implicitly
- **WHEN** the user sets `npm_config_yes=false` in the command-options env list
- **THEN** the spawned env SHALL carry `false` and the dialog SHALL show the entry as user-configured
- **WHEN** the user removes the entry (from the dialog or the env list)
- **THEN** the preset SHALL be off — the dialog shows the enable affordance, the indicator icon disappears, and nothing is injected
