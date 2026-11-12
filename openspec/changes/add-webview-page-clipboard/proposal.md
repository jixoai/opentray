# Add the WebView page clipboard capability

## Why

WebView pages need a generic text clipboard API that targets the system clipboard owned by the visible WebView client. Routing clipboard calls through the broker would target the wrong machine when the runtime and UI client are separated, and would duplicate the host-side clipboard extension.

## Scope

Expose `navigator.opentray.clipboard.readText()` and `writeText(text)` as a source-policy-gated page capability. Delegate to the client's native browser Clipboard API so user activation, browser permissions, platform behavior, and errors remain authoritative. Keep `@opentray/ext-clipboard` as the host-side Node API.

## Non-goals

- No clipboard data is transported through Core, the broker, or extension protocol frames.
- No permission bypass, hidden user gesture, image/file clipboard support, or Linux native WebView package.
- No changes to gh-runner or other consumers.
