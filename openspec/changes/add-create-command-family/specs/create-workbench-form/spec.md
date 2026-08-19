## MODIFIED Requirements

### Requirement: Form structure SHALL use progressive disclosure without hiding consequences

High-frequency command, preview, identity, and primary creation actions SHALL remain directly visible. Lower-frequency command environment, icon composition/sampling, shell/window, package manager, and developer controls MAY live in clearly named progressive sections. Command family structure lives in a form dialog behind the read-only command body, which is progressive disclosure; its env-preset consequence SHALL remain observable outside the dialog through the command-row indicator icon and its tooltip, so collapsing the dialog cannot hide that environment values will be injected. Destructive edit force, env-export risk, external target, and process-stop consequences SHALL reappear in the final plan review even when their controls were collapsed.

#### Scenario: Collapsed advanced section cannot hide risk

- **GIVEN** advanced settings contain env values and a running-app stop choice
- **WHEN** the user collapses the section and opens final review
- **THEN** review SHALL still display both consequences and require their applicable acknowledgements

#### Scenario: Closed family dialog cannot hide the env preset

- **GIVEN** an npm-series npx command primed with the env preset active and the form dialog closed
- **WHEN** the user inspects the command row
- **THEN** the env indicator icon with its tooltip SHALL still disclose that an environment entry is injected
