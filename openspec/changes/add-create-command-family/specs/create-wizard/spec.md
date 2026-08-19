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

### Requirement: NPM-Series Commands SHALL Auto-Inject The Confirmation-Skipping Env Preset

The wizard SHALL automatically add the environment preset
`npm_config_yes=true` (skip the first-run install confirmation, equivalent to
`-y`) whenever the submitted command parses as the npm family with runner
`npx` or `pnpx`, merging it into the run environment overlay and into the
persisted/frozen command env of generated apps and exports, unless the user
explicitly disabled the preset. The preset SHALL be visible in the command row
as an indicator icon whose tooltip (hover and click-to-pin) lists the injected
entries, and removable or restorable from the form dialog; disabling state
SHALL persist with the wizard draft. The existing env-export acknowledgement
law SHALL apply unchanged to the injected entries.

#### Scenario: Preset is injected on run and in the generated app

- **GIVEN** the command `npx @deepseek-ai/dsh@latest web` primed
- **WHEN** the user runs it and later confirms generation
- **THEN** the spawned process env SHALL include `npm_config_yes=true`
- **AND** the generated app config command env SHALL include the same entry

#### Scenario: Preset is visible and removable

- **GIVEN** an npm-series npx command primed
- **THEN** the command row SHALL show the env indicator icon whose tooltip names `npm_config_yes=true`
- **WHEN** the user removes the preset in the form dialog and re-runs
- **THEN** the spawned env SHALL NOT include the entry and the indicator SHALL disappear

#### Scenario: Other runners and families inject nothing

- **GIVEN** commands using `bunx`, `yarn dlx`, `deno run`, `uvx`, `go run`, `dnx`, or a custom command
- **WHEN** primed and run
- **THEN** no environment preset SHALL be injected
