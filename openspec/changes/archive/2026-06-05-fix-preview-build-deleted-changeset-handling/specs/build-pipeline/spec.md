## MODIFIED Requirements

### Requirement: Changeset build marker SHALL be the explicit preview-build intent surface

OpenTray SHALL treat a machine-readable build marker inside a changeset file as the explicit request to spend CI resources on a preview build. A changed changeset file without that marker SHALL cause the workflow to no-op after planning.

#### Scenario: Deleted changed changeset is ignored during preview planning

- **GIVEN** a push changes one or more `.changeset/*.md` paths
- **AND** at least one of those paths was deleted in the resulting checkout
- **WHEN** the preview planner inspects changed changesets
- **THEN** deleted paths are ignored instead of causing file-read failure
- **AND** any remaining live marked changeset still drives the preview plan normally
