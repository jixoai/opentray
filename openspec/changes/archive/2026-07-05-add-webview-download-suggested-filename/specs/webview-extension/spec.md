## ADDED Requirements

### Requirement: Download event payload SHALL preserve suggested filename separately from filename

The WebView extension SHALL preserve source-truth filename suggestion separately from the existing `filename` projection in every download lifecycle payload. Each `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled` payload SHALL include `suggestedFilename`, whose value is either:

- the pre-deduped substrate filename suggestion when the native engine exposes one, or
- `null` when the native engine does not expose a distinct suggested filename.

The extension SHALL NOT overwrite `suggestedFilename` with the deduped or final saved filename. The extension SHALL keep `filename` as the existing field so current consumers do not break.

#### Scenario: Suggested filename survives collision dedupe

- **GIVEN** a WebView download trigger whose substrate suggestion is `backup.json`
- **AND** the final saved file is deduplicated to `backup (6).json`
- **WHEN** any download lifecycle event payload is emitted
- **THEN** the payload contains `suggestedFilename: "backup.json"`
- **AND** the payload keeps `filename` as the existing event field rather than rewriting it to match `suggestedFilename`.

#### Scenario: Missing substrate suggestion stays honest

- **GIVEN** a platform download substrate does not expose a distinct suggested filename
- **WHEN** any download lifecycle event payload is emitted
- **THEN** the payload contains `suggestedFilename: null`
- **AND** the extension does not fabricate a separate suggestion by pretending the current `filename` projection is source truth.

## MODIFIED Requirements

### Requirement: Webview SHALL expose download lifecycle events on the navigator window bus

The extension SHALL expose download lifecycle events through the existing `navigator.opentrayWindow` / `navigator.window` event bus (the same `listen` / `once` mechanism used by `windowstatechange`, `stylechange`, and similar native state changes). This change SHALL NOT introduce a separate download event namespace.

The download event set SHALL be exactly: `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled`. Event names SHALL NOT carry a `download:` prefix; they follow the same unprefixed naming convention as `moved`, `resized`, and `closed`.

Download events SHALL be subscription-driven: the extension SHALL NOT push download events to a page that has not registered a listener for that specific event. The `downloadcompleted` payload SHALL be uniform across platforms and SHALL NOT include the final filesystem path, because the underlying macOS engine limitation prevents reliably reporting the saved path; payloads SHALL carry `{ url, filename, suggestedFilename, success }` instead. The `downloadprogress` payload SHALL carry `{ url, filename, suggestedFilename, receivedBytes, totalBytes }` and leave percentage computation to the page. The `downloadstarted`, `downloadfailed`, and `downloadcanceled` payloads SHALL carry `{ url, filename, suggestedFilename }`.

On macOS the extension SHALL observe `WKDownload` progress via key-value observing so that `downloadprogress` is reliable; it SHALL NOT degrade macOS progress to a best-effort or absent signal. On macOS the extension SHALL preserve `WKDownloadDelegate`'s `suggestedFilename` separately from the final deduped basename. On Windows the extension SHALL preserve a distinct suggested filename only when the WebView2 substrate exposes one; it SHALL emit `suggestedFilename: null` rather than inventing a false source fact. On Windows the extension SHALL use the WebView2 `DownloadOperation` bytes-received state changes, which are natively reliable.

#### Scenario: Page listens for download lifecycle events

- **GIVEN** a WebView is shown with native window API enabled and the default `download` option
- **WHEN** the page registers `navigator.opentrayWindow.listen("downloadstarted", handler)`
- **AND** the page then triggers a download
- **THEN** the handler fires with a payload containing `url`, `filename`, and `suggestedFilename`
- **AND** the same listener registration path is used as for `windowstatechange`.

#### Scenario: Progress events are reliable on macOS

- **GIVEN** a WebView is shown on macOS with native window API enabled
- **WHEN** the page registers a `downloadprogress` listener and triggers a multi-byte download
- **THEN** the handler fires one or more times with increasing `receivedBytes`
- **AND** `totalBytes` reflects the response content length when available
- **AND** the progress is sourced from a `WKDownload` KVO observer, not from polling.

#### Scenario: Completed event omits the saved path on all platforms

- **GIVEN** a WebView is shown on either macOS or Windows
- **WHEN** a registered `downloadcompleted` listener receives an event
- **THEN** the payload contains `{ url, filename, suggestedFilename, success }`
- **AND** the payload does not contain a `path` field, regardless of platform.

#### Scenario: No listener means no event delivery

- **GIVEN** a WebView is shown with the default `download` option
- **WHEN** the page triggers a download but has registered no download event listener
- **THEN** the extension does not push any download event payload to the page
- **AND** the download still proceeds normally to the Downloads directory.

#### Scenario: Canceled saveAs emits the canceled event

- **GIVEN** a WebView is shown with `download: { saveAs: true }`
- **AND** the page has registered a `downloadcanceled` listener
- **WHEN** the user dismisses the save-location dialog
- **THEN** the listener fires with a payload containing `url`, `filename`, and `suggestedFilename`
- **AND** the event name is `downloadcanceled`, not `downloadfailed`.

## REMOVED Requirements

None.

## RENAMED Requirements

None.
