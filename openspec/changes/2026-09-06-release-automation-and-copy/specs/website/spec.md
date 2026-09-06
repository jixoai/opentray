## ADDED Requirements

### Requirement: Purpose-led bilingual copy

The site copy SHALL lead with the problem the project exists to solve
(sourced from the repo's intent documents), in both locales, with every
claim traceable to README/openspec/AGENTS sources — feature inventories
without motivation are rejected.

#### Scenario: hero narrates purpose

- **WHEN** the home page renders in either locale
- **THEN** the hero states what problem OpenTray solves for CLI/AI-skill
  authors before listing capabilities, and each feature section carries
  a motivation sentence.
