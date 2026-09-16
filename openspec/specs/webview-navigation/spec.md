# webview-navigation Specification

## Purpose
TBD - created by archiving change add-navigation-favicon-surface. Update Purpose after archive.

## Requirements

### Requirement: Webviews SHALL push per-view navigation actions with type and gesture attribution

The per-view event family SHALL gain a `navigationAction` kind. Every navigation decision point on the native platform delegates (macOS `decidePolicyForNavigationAction`, Windows `NavigationStarting`) SHALL push one `navigationAction` frame before the load surfaces as `loadState` phases. The payload SHALL be field-frozen as `{ url, navigationType, isUserInitiated? }` where `navigationType` is one of `"link" | "form" | "backForward" | "reload" | "redirect" | "other"`. Platform projection SHALL be documented, not invented: macOS maps `WKNavigationAction.navigationType` (redirect is not directly observable there and projects as `"other"` unless the action carries no user gesture and the URL differs within a load chain the platform reports); Windows maps `IsRedirected` to `"redirect"` precisely and cannot separate link from form, projecting user-initiated navigations as `"link"`. Frames carry the standard `{ owner, windowId, webviewId, seq }` envelope, classify as Edge on the EventPort (never coalesced), and are producer-gated: no facade subscription, no native observation record.

#### Scenario: A link click arrives with attribution

- **GIVEN** a composed window with a subscribed content webview showing a page with a link
- **WHEN** the user activates the link
- **THEN** one `navigationAction` frame arrives with `{ url, navigationType: "link", isUserInitiated: true }` followed by the existing `loadState started/finished` chain for the same URL.

#### Scenario: Redirects are visible per platform truth

- **GIVEN** a navigation that the server redirects
- **WHEN** the redirect leg reaches the platform decision point
- **THEN** Windows pushes `navigationType: "redirect"` with `isUserInitiated: false`
- **AND** macOS pushes the frame with its best platform truth, documented as not distinguishing redirect from `"other"`.

#### Scenario: No subscription, no records

- **GIVEN** a webview with no `onNavigationAction` listener
- **WHEN** navigations occur
- **THEN** the native producer emits no observation record and the EventPort carries no `navigationAction` traffic.

### Requirement: Navigation veto SHALL be a declarative native-evaluated rule table

A webview SHALL accept a `navigationRules` array at creation and a `setNavigationRules(rules)` mutation command. One rule SHALL be `{ pattern: string, action: "block" }` (v1 actions: `block` only). Patterns SHALL be glob-style over the full URL (`*` wildcard, no regex). Rules SHALL be evaluated synchronously inside the native decision point (macOS deciding `WKNavigationActionPolicyCancel`, Windows setting `NavigationStartingEventArgs.Cancel`); the host SHALL never be asked over IPC during a navigation decision. A blocked navigation SHALL surface to consumers as one `navigationAction` frame followed by a `loadState` failed frame whose `errorCode` is the registered stable code for `navigation_blocked`; the registered code SHALL NOT collide with platform `WebErrorStatus` values. Rule updates SHALL apply to the next navigation without replay or history rewriting. An empty rule list restores allow-all.

#### Scenario: A blocked domain never loads

- **GIVEN** a content webview created with `navigationRules: [{ pattern: "*://*.tracker.example/*", action: "block" }]`
- **WHEN** the page navigates to `https://cdn.tracker.example/pixel.gif`
- **THEN** the navigation is cancelled natively before any request leaves the process
- **AND** consumers observe `loadState` failed with the `navigation_blocked` error code
- **AND** the webview stays on the prior page.

#### Scenario: Rule updates take effect on the next navigation

- **GIVEN** a webview with a block rule currently in force
- **WHEN** the host calls `setNavigationRules([])`
- **AND** the page retries the previously blocked URL
- **THEN** the navigation proceeds normally.

#### Scenario: The decision never waits on the host

- **GIVEN** any rule configuration and an idle host session with no commands in flight
- **WHEN** a navigation reaches the decision point
- **THEN** the allow/block verdict is computed entirely inside the native decision callback without any socket round-trip.
