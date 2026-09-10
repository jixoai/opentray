## ADDED Requirements

### Requirement: Wizard icon candidates SHALL separate app art from tray-template art

The app-icon picker SHALL offer original candidates and subject-extraction candidates only; solid-color silhouettes SHALL remain exclusive to the advanced tray picker where they serve tray-template selection. The icon composition card (background choice, foreground scale, composed preview) SHALL stay hidden until the user EXPLICITLY selects an icon (candidate pick or upload) — a committed URL/command preset SHALL NOT surface it, because the server form cannot distinguish a preset-committed icon from a user pick and the webui selection state is the visibility authority. Selecting a subject-extraction candidate SHALL NOT mark the tray icon as a solid macOS template.

#### Scenario: App picker filters tray-template silhouettes

- **GIVEN** scraped candidates plus a subject extraction whose silhouettes were derived
- **WHEN** the app-icon picker renders
- **THEN** it SHALL list only the original candidates and the subject extraction, while the advanced tray picker offers the solid variants

#### Scenario: Composition card follows explicit selection only

- **GIVEN** the wizard form after a URL/command preset commits an icon path without a user pick
- **WHEN** the identity form renders
- **THEN** the background/scale/preview composition card SHALL be absent
- **AND** once the user picks a candidate or uploads an image the card SHALL appear with its analysis

### Requirement: The wizard WebUI SHALL derive subject-extraction candidates in the browser

The wizard WebUI SHALL run browser-side AI subject extraction on the clearest scraped original candidate, using the lazily-imported `@imgly/background-removal` runtime, and SHALL append the extracted subject as an additional icon candidate through a wizard-session API that persists the derived bytes in the session-owned icon directory and broadcasts the updated candidate list to connected clients. The session SHALL derive the tray-template silhouettes (solid-black and solid-white) from the appended subject's alpha mask — never from opaque original favicons, whose masks are full squares — and append them alongside the subject. Model and ONNX Runtime wasm assets SHALL be loaded through a wizard-server proxy route backed by a persistent on-disk cache (`~/.opentray/cache/imgly-data/<version>/`): the wizard rebinds a random port every launch, so only a backend cache survives across sessions — the backend downloads from the vendor CDN once (atomically committed, concurrency-deduped, size-bounded) and the browser always fetches from loopback. Derived candidates SHALL respect the same port scoping and selection semantics as scraped candidates. Subject extraction is an enhancement, never a gate: every failure path (model load, unsupported runtime, decode failure) SHALL degrade silently to the scraped candidates, and at most one extraction SHALL run per source candidate per page session. Build tooling SHALL exclude both the unused ONNX wasm copies Vite emits and the vendored model assets from the generated-app shell payload.

#### Scenario: Subject candidate arrives with tray silhouettes

- **GIVEN** scraped candidates whose clearest original exists
- **WHEN** the browser completes subject extraction
- **THEN** the app-icon picker SHALL gain one additional candidate labeled as an AI subject extraction, selectable like any scraped candidate
- **AND** the advanced tray picker SHALL gain solid-color silhouettes derived from that subject's alpha mask

#### Scenario: Model assets load from the backend cache

- **GIVEN** a wizard session (any port)
- **WHEN** subject extraction runs
- **THEN** the model and runtime chunks SHALL be fetched from the wizard's loopback proxy, with the first miss downloaded once from the vendor CDN into the persistent disk cache
- **AND** a later wizard on a DIFFERENT random port SHALL be served from that disk cache without re-downloading

#### Scenario: Extraction failure is silent

- **GIVEN** a browser that cannot load the model or run inference
- **WHEN** extraction is attempted
- **THEN** the wizard SHALL keep the scraped candidates with no error surface, and SHALL NOT retry the same source within the page session

#### Scenario: Derived candidates are port-scoped

- **GIVEN** candidates scoped to a service port
- **WHEN** a derivation is submitted for a different port or an unknown source candidate
- **THEN** the session SHALL reject the append without mutating the candidate list
