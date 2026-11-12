# Tasks

- [x] Add a page clipboard capability to the WebView bootstrap, gated by `nativeApiPolicy.clipboard` and the normal local-only default.
- [x] Delegate text read/write to the WebView client's browser Clipboard API and preserve browser errors.
- [x] Test read/write forwarding, invalid write input, frozen API shape, and source-policy denial.
- [x] Document client ownership, permission/user-activation constraints, and the distinction from host-side `@opentray/ext-clipboard`.
- [x] Validate OpenSpec and run the focused Rust crate tests; TypeScript package checks could not run because workspace `node_modules` is absent.
