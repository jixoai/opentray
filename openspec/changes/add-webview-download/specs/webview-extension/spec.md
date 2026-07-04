## ADDED Requirements

### Requirement: Webview SHALL support standard HTML download semantics

The WebView extension SHALL install native download handlers on the underlying webview engine so that standard HTML download triggers produce a real local file. A download trigger is any of: an `<a download="filename">` activation, a navigation to a `blob:` URL with a download disposition, or a response with a non-displayable MIME type that the engine routes to download. The extension SHALL NOT silently cancel download-triggered navigations the way an unconfigured webview engine does by default.

When the download capability is enabled for a shown WebView (the default), the extension SHALL route every triggered download through the operating system's standard Downloads directory (`~/Downloads` on macOS, `%USERPROFILE%\Downloads` on Windows) unless an opt-in saveAs policy is active. The extension SHALL deduplicate filename collisions by appending a numeric suffix, matching browser behavior.

The download capability SHALL be controlled by a top-level `download` option on the `show(...)` command. The option SHALL default to `{ enabled: true, saveAs: false }` so that trivial page code (e.g. `const a = document.createElement('a'); a.download = 'x.json'; a.click();`) works with zero additional configuration.

The extension SHALL report a typed unsupported error on platforms where the WebView runtime itself is unsupported, rather than faking a successful download. On Linux the download capability follows the overall `@opentray/ext-webview` Linux stance: unsupported by design.

#### Scenario: Anchor download attribute produces a local file

- **GIVEN** a WebView is shown with local HTML content and the default `download` option
- **WHEN** page code creates `<a download="report.json">` pointing at a `blob:` URL and clicks it
- **THEN** a file named `report.json` appears in the operating system's standard Downloads directory
- **AND** the page receives no unhandled navigation error.

#### Scenario: Filename collision does not overwrite

- **GIVEN** a file named `report.json` already exists in the Downloads directory
- **AND** a WebView is shown with the default `download` option
- **WHEN** page code triggers another download with `download="report.json"`
- **THEN** the new file is written as `report (1).json` (or the platform-equivalent deduplicated name)
- **AND** the pre-existing `report.json` is not overwritten.

#### Scenario: Download defaults to enabled with zero configuration

- **GIVEN** a WebView is shown with local HTML content and no explicit `download` option
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory
- **AND** the page did not have to call any extension-specific API to enable downloading.

#### Scenario: Disabled download option suppresses downloads

- **GIVEN** a WebView is shown with `download: { enabled: false }`
- **WHEN** the page triggers a standard HTML download
- **THEN** no file is written
- **AND** the extension does not crash or leave the webview in a broken navigation state.

#### Scenario: Unsupported platform does not fake download success

- **GIVEN** the host platform lacks a supported WebView runtime (e.g. Linux)
- **WHEN** a caller shows a WebView with the default `download` option
- **THEN** the extension reports a typed unsupported/capability error
- **AND** it does not claim a download succeeded.

### Requirement: Webview download SHALL be governed by the multipleDownloads permission family

The extension SHALL consult the existing `multipleDownloads` browser permission family before allowing a download to proceed. The permission decision SHALL follow the same `allow` / `deny` / `prompt` ontology already defined for other browser permission families, and the same per-origin source rule model.

Local page sources SHALL be allowed to download by default. Remote page sources SHALL be denied by default unless an explicit policy rule allows them. Until the carrier-owned native permission prompt substrate exists, a resolved `prompt` decision SHALL fail closed for downloads: the extension SHALL block the download and SHALL NOT introduce a parallel download-specific prompt UI.

The `multipleDownloads` permission family already exists in the TypeScript facade permission store and in the native permission policy parser; this requirement makes the platform webview builder actually consume it for download gating, removing the prior dead-code state where the family was parsed but never enforced.

#### Scenario: Local page download is allowed by default

- **GIVEN** a WebView is shown with local HTML content and no explicit `browserPermissionPolicy` for `multipleDownloads`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory.

#### Scenario: Remote page download is denied by default

- **GIVEN** a WebView is shown with remote URL content and no explicit allow rule for `multipleDownloads`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download is blocked
- **AND** no file is written to the Downloads directory.

#### Scenario: Explicit allow rule permits a remote download

- **GIVEN** a WebView is shown with remote URL content from `https://tools.example`
- **AND** the caller supplied `browserPermissionPolicy: { multipleDownloads: { sources: ["'https://tools.example'"], decision: "allow" } }`
- **WHEN** the page triggers a standard HTML download
- **THEN** the download proceeds to the Downloads directory.

#### Scenario: Prompt decision fails closed until the carrier prompt substrate exists

- **GIVEN** a WebView is shown with a `multipleDownloads` policy of `decision: "prompt"`
- **WHEN** the page triggers a standard HTML download
- **THEN** the extension blocks the download
- **AND** this change does not render its own download-specific prompt UI.

### Requirement: Webview saveAs SHALL be an explicit opt-in over the default silent download

The extension SHALL provide a `saveAs` flag on the `download` option, defaulting to `false`. When `saveAs` is `false`, downloads SHALL be written silently to the standard Downloads directory with filename deduplication, requiring no user interaction.

When `saveAs` is `true`, the extension SHALL present the operating system's native save-location dialog before writing the file. On macOS this SHALL be `NSSavePanel`, presented from inside the wry download-started handler so that the chosen path is written back to the download destination before the engine commits the file. On Windows this SHALL be the WebView2 native Save As behavior exposed through the `DownloadStarting` event.

If the user cancels the native save-location dialog, the extension SHALL NOT write any file, SHALL NOT treat the cancellation as a failure, and SHALL emit a `downloadcanceled` event to the page (see the download-events requirement).

#### Scenario: Default silent download writes without a dialog

- **GIVEN** a WebView is shown with the default `download` option (`saveAs: false`)
- **WHEN** the page triggers a standard HTML download
- **THEN** no save-location dialog is shown
- **AND** the file is written directly to the Downloads directory.

#### Scenario: saveAs true presents a native save dialog on macOS

- **GIVEN** a WebView is shown on macOS with `download: { saveAs: true }`
- **WHEN** the page triggers a download with suggested filename `backup.json`
- **THEN** an `NSSavePanel` is presented with `backup.json` as the suggested name
- **AND** when the user confirms a location, the file is written to that location.

#### Scenario: saveAs true presents native Save As on Windows

- **GIVEN** a WebView is shown on Windows with `download: { saveAs: true }`
- **WHEN** the page triggers a download
- **THEN** the WebView2 native Save As behavior is used
- **AND** no custom dialog implementation is rendered by this extension.

#### Scenario: User canceling saveAs does not write a file

- **GIVEN** a WebView is shown with `download: { saveAs: true }`
- **WHEN** the page triggers a download
- **AND** the user dismisses the native save-location dialog without choosing a path
- **THEN** no file is written
- **AND** the page receives a `downloadcanceled` event (not a `downloadfailed` event).

### Requirement: Webview SHALL expose download lifecycle events on the navigator window bus

The extension SHALL expose download lifecycle events through the existing `navigator.opentrayWindow` / `navigator.window` event bus (the same `listen` / `once` mechanism used by `windowstatechange`, `stylechange`, and similar native state changes). This change SHALL NOT introduce a separate download event namespace.

The download event set SHALL be exactly: `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled`. Event names SHALL NOT carry a `download:` prefix; they follow the same unprefixed naming convention as `moved`, `resized`, and `closed`.

Download events SHALL be subscription-driven: the extension SHALL NOT push download events to a page that has not registered a listener for that specific event. The `downloadcompleted` payload SHALL be uniform across platforms and SHALL NOT include the final filesystem path, because the underlying macOS engine limitation prevents reliably reporting the saved path; payloads SHALL carry `{ url, filename, success }` instead. The `downloadprogress` payload SHALL carry `{ url, filename, receivedBytes, totalBytes }` and leave percentage computation to the page.

On macOS the extension SHALL observe `WKDownload` progress via key-value observing so that `downloadprogress` is reliable; it SHALL NOT degrade macOS progress to a best-effort or absent signal. On Windows the extension SHALL use the WebView2 `DownloadOperation` bytes-received state changes, which are natively reliable.

#### Scenario: Page listens for download lifecycle events

- **GIVEN** a WebView is shown with native window API enabled and the default `download` option
- **WHEN** the page registers `navigator.opentrayWindow.listen("downloadstarted", handler)`
- **AND** the page then triggers a download
- **THEN** the handler fires with a payload containing `url` and `filename`
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
- **THEN** the payload contains `{ url, filename, success }`
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
- **THEN** the listener fires with a payload containing `url` and `filename`
- **AND** no `downloadfailed` event is emitted for the same download.

### Requirement: Webview download events SHALL be human-verifiable

The repository SHALL ship a runnable example that demonstrates the full download lifecycle a human can observe. The example SHALL exercise at minimum: a standard `<a download>` trigger against a `blob:` URL, a registered set of download event listeners rendering lifecycle state, and the default silent-download behavior. The example SHALL follow the same naming and staging pattern as `example:webview-control`, `example:placement`, and `example:mediaQuery`.

#### Scenario: Maintainer runs the download example

- **GIVEN** the repository is built and the native WebView library is staged
- **WHEN** a maintainer runs `pnpm --filter opentray example:download`
- **THEN** a WebView window opens
- **AND** clicking the demonstrated download trigger writes a real file to the Downloads directory
- **AND** the example's UI reflects `downloadstarted` → `downloadprogress` → `downloadcompleted` transitions.
