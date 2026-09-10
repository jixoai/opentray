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

The wizard WebUI SHALL run browser-side AI subject extraction on the clearest scraped original candidate, using the lazily-imported `@imgly/background-removal` runtime, and SHALL append the extracted subject as an additional icon candidate through a wizard-session API that persists the derived bytes in the session-owned icon directory and broadcasts the updated candidate list to connected clients. The session SHALL derive the tray-template silhouettes (solid-black and solid-white) from the appended subject's alpha mask — never from opaque original favicons, whose masks are full squares — and append them alongside the subject. Model and ONNX Runtime wasm assets SHALL be loaded through a wizard-server proxy route backed by a persistent on-disk cache (`~/.opentray/cache/imgly-data/<version>/`): the wizard rebinds a random port every launch, so only a backend cache survives across sessions — the backend downloads from the vendor CDN once (atomically committed, concurrency-deduped, size-bounded) and the browser always fetches from loopback. Derived candidates SHALL respect the same port scoping and selection semantics as scraped candidates. Subject extraction is an enhancement, never a gate: every failure path (model load, unsupported runtime, decode failure) SHALL degrade silently to the scraped candidates, and at most one extraction SHALL run per source candidate per candidate GENERATION — the session stamps every scrape-side list replacement with a bumped generation (carried by the icons event and snapshot) so a dynamic URL switch re-triggers extraction even when the new page's favicon bytes are identical to the previous one, while appends keep the generation stable, and an in-flight extraction superseded by a generation change SHALL be discarded instead of appended to the new list. Candidate thumbnail identity SHALL be the `(index, generation)` pair: the icon-data URL SHALL embed the generation so that any list whose bytes changed under a recycled index emits a different URL string and the browser re-fetches — a stable URL string leaves the prior image rendered even with no-store responses. A subject re-derivation from the same source SHALL REPLACE the prior subject and every silhouette derived from it (indexes may be legitimately recycled) and SHALL bump the generation, so re-extraction never stacks duplicates and its thumbnail always refreshes. Build tooling SHALL exclude both the unused ONNX wasm copies Vite emits and the vendored model assets from the generated-app shell payload.

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

#### Scenario: A URL switch re-triggers extraction

- **GIVEN** a URL-mode session whose subject candidate was appended
- **WHEN** the user submits a different URL and the scrape replaces the candidate list
- **THEN** the generation SHALL bump and the subject extraction SHALL run again for the new list, even when the favicon bytes are identical to the previous URL's

#### Scenario: Thumbnails refresh across generations

- **GIVEN** a candidate list rendered with generation N
- **WHEN** the list is replaced (URL switch, or a subject re-extraction recycling an index slot) and the new generation is broadcast
- **THEN** every thumbnail URL SHALL embed generation N+1 so the browser fetches the new bytes instead of keeping the prior image at an unchanged URL string

#### Scenario: Re-extraction replaces the prior subject

- **GIVEN** a session whose subject candidate and its derived silhouettes exist
- **WHEN** a new subject derivation for the same source candidate is submitted
- **THEN** the session SHALL keep exactly one subject and one pair of derived silhouettes — the prior subject's bytes SHALL leave the list
- **AND** the generation SHALL bump so the recycled index slot renders the new bytes

#### Scenario: Derived candidates are port-scoped

- **GIVEN** candidates scoped to a service port
- **WHEN** a derivation is submitted for a different port or an unknown source candidate
- **THEN** the session SHALL reject the append without mutating the candidate list

### Requirement: Subject extraction settings SHALL apply automatically and keep an active selection fused

The webui SHALL expose an advanced extraction panel with a model-precision choice (full-precision, standard fp16, and quantized variants of the isnet model), an alpha threshold (0–128, zeroing mask alpha below the threshold), and an edge shrink (0–6 px, eroding the mask with N 3×3 minimum-filter passes). Post-processing SHALL be a pure function over structured pixel data so it is testable without a browser canvas. There SHALL be no explicit apply button: every committed settings change (a model tap or a settled slider value) SHALL re-run extraction for the current top original with the latest settings through the replacement semantics above — continuous slider drags SHALL coalesce into one trailing run, and a change landing while an extraction is in flight SHALL defer exactly one further run with the latest settings instead of dropping or stacking. When a generation bump replaces the bytes under a LIVE selection (the selected index still exists in the new list), the webui SHALL re-commit that selection (app icon, and tray icon when one is picked) so the server form points at the new file and the existing analysis/background-suggestion/composition pipeline re-fuses automatically.

#### Scenario: Settings changes re-extract automatically

- **GIVEN** the advanced extraction panel with a rendered subject
- **WHEN** the user changes a slider (or taps a different model precision) and takes no further action
- **THEN** extraction SHALL re-run with the latest settings after the input settles, replacing the prior subject and its silhouettes
- **AND** a fast drag through several values SHALL produce exactly one re-extraction with the final value

#### Scenario: An active selection re-fuses after replacement

- **GIVEN** the user has selected the subject candidate and the composition card shows a fused preview
- **WHEN** a settings change (or URL switch) replaces the bytes under that selected index
- **THEN** the selection SHALL be re-committed against the new candidate list and the composition preview SHALL re-render from the new bytes without any user action
