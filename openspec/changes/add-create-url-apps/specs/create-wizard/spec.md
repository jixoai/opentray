## ADDED Requirements

### Requirement: Wizard icon candidates SHALL separate app art from tray-template art

The app-icon picker SHALL offer original candidates and subject-extraction candidates only; solid-color silhouettes SHALL remain exclusive to the advanced tray picker where they serve tray-template selection. The icon composition card (background choice, foreground scale, composed preview) SHALL stay hidden while no icon source is in effect and SHALL appear once a foreground exists (scraped default, explicit pick, or upload). Selecting a subject-extraction candidate SHALL NOT mark the tray icon as a solid macOS template.

#### Scenario: App picker filters tray-template silhouettes

- **GIVEN** scraped candidates that include solid-color silhouette variants
- **WHEN** the app-icon picker renders
- **THEN** it SHALL list only the original candidates (plus any subject extractions), while the advanced tray picker keeps offering the solid variants

#### Scenario: Composition card follows the foreground

- **GIVEN** the wizard form with no scraped, picked, or uploaded icon
- **WHEN** the identity form renders
- **THEN** the background/scale/preview composition card SHALL be absent
- **AND** once any icon source becomes effective the card SHALL appear with its analysis

### Requirement: The wizard WebUI SHALL derive subject-extraction candidates in the browser

The wizard WebUI SHALL run browser-side AI subject extraction on the clearest scraped original candidate, using the lazily-imported `@imgly/background-removal` runtime with model assets streamed from the vendor CDN, and SHALL append the extracted subject as an additional icon candidate through a wizard-session API that persists the derived bytes in the session-owned icon directory and broadcasts the updated candidate list to connected clients. Derived candidates SHALL respect the same port scoping and selection semantics as scraped candidates. Subject extraction is an enhancement, never a gate: every failure path (model download, unsupported runtime, decode failure) SHALL degrade silently to the scraped candidates, and at most one extraction SHALL run per source candidate per page session. Build tooling SHALL exclude the unused ONNX wasm copies emitted into the webui dist from the published wizard payload.

#### Scenario: Subject candidate arrives as a pickable option

- **GIVEN** scraped candidates whose clearest original exists
- **WHEN** the browser completes subject extraction
- **THEN** the app-icon picker SHALL gain one additional candidate labeled as an AI subject extraction, selectable like any scraped candidate

#### Scenario: Extraction failure is silent

- **GIVEN** a browser that cannot download the model or run inference
- **WHEN** extraction is attempted
- **THEN** the wizard SHALL keep the scraped candidates with no error surface, and SHALL NOT retry the same source within the page session

#### Scenario: Derived candidates are port-scoped

- **GIVEN** candidates scoped to a service port
- **WHEN** a derivation is submitted for a different port or an unknown source candidate
- **THEN** the session SHALL reject the append without mutating the candidate list
