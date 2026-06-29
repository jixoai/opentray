## ADDED Requirements

### Requirement: Permission store SHALL be app-scoped JS source of truth

OpenTray SHALL provide a default JavaScript permission database for out-of-the-box durable browser permission grants. The default store SHALL be app-scoped, SHALL use OpenTray `appId` as its default namespace, and SHALL stay outside WebView page-local storage such as IndexedDB, localStorage, or sessionStorage.

The store SHALL live at the app/runtime JavaScript layer so both backend SDK flows and `opentrayPermissions` page capability flows can use the same durable permission facts. Applications MAY provide an explicit namespace override or custom permission store adapter.

#### Scenario: Default store is namespaced by app id

- **GIVEN** an app starts OpenTray with app id `com.example.tray`
- **WHEN** the default permission store is opened
- **THEN** durable permission facts are stored under an app-scoped namespace derived from `com.example.tray`
- **AND** another app id does not share the same permission facts.

#### Scenario: Frontend storage is not the default source

- **GIVEN** a WebView page receives `opentrayPermissions`
- **WHEN** it reads or mutates durable permission facts
- **THEN** the operation goes through the app-scoped permission store
- **AND** WebView page IndexedDB, localStorage, or sessionStorage is not the default durable permission source of truth.

### Requirement: Permission facts SHALL use a durable typed record shape

Durable permission facts SHALL be stored as typed records that include at minimum app namespace, source scope, exact remote origin when applicable, permission family, decision, creation/update metadata, and source attribution. Valid durable decisions SHALL include allow and deny. Session-scoped allow-once SHALL NOT be written as a durable fact.

Source scope SHALL distinguish local sources from exact remote origins. Remote records SHALL NOT use wildcard host matching for durable allow by default.

#### Scenario: Durable allow records preserve origin and family

- **GIVEN** an exact remote origin is granted durable camera permission
- **WHEN** the permission store writes the record
- **THEN** the record includes the app namespace, `https://...` exact origin, camera family, allow decision, and source attribution
- **AND** the grant does not apply to sibling origins.

#### Scenario: Allow-once stays out of durable storage

- **GIVEN** a WebView session receives allow-once for microphone
- **WHEN** permission state is queried from the durable permission store
- **THEN** no durable allow record exists for that allow-once decision
- **AND** the session-scoped grant remains only in WebView permission session state.

### Requirement: opentrayPermissions SHALL be a scoped permission-management object

`opentrayPermissions` SHALL be the page-side permission-management object exposed only when injection policy enables it for the current source. For local sources it MAY be enabled by default policy. For remote origins it SHALL be disabled by default and require an exact-origin injection policy.

The object SHALL provide fine-grained operations for querying permission capability, reading current permission state, requesting permission, writing or clearing durable allow/deny records when policy allows management, and observing permission changes. It SHALL NOT bypass browser permission policy, prompt-confirmation policy, source policy, or unsupported platform capability.

#### Scenario: Local page uses permission manager

- **GIVEN** a local WebView page has `opentrayPermissions` enabled
- **WHEN** it queries camera permission state
- **THEN** the result is derived from WebView session state, app-scoped durable store, source policy, and platform capability
- **AND** it is not derived from page-local storage.

#### Scenario: Permission manager cannot grant unsupported capability

- **GIVEN** a page calls `opentrayPermissions.request("localFonts")`
- **WHEN** the current platform cannot support local font permission control
- **THEN** the promise rejects or resolves with a typed unsupported result
- **AND** no durable allow record is written as if the capability succeeded.

## MODIFIED Requirements

## REMOVED Requirements

## RENAMED Requirements
