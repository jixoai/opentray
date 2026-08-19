## 1. Specification

- [x] 1.1 Record the 'pnpx' startup failure and executable-relative WebView2 profile diagnosis.
- [x] 1.2 Define explicit profile path, isolation, override, lifetime, and diagnostics requirements.

## 2. Windows Host

- [x] 2.1 Add a stable profile-path resolver with explicit override and sanitized identity components.
- [x] 2.2 Retain 'WebContext' beside 'WebView' and construct through 'new_with_web_context'.
- [x] 2.3 Include the resolved profile path in WebView2 construction errors.

## 3. Domain Records

- [x] 3.1 Update 'AGENTS.md' with the executable-path-independent WebView2 profile law.
- [x] 3.2 Update 'i18n.zh.md' with profile, temporary package path, and WebView2 startup vocabulary.

## 4. Verification and Release

- [x] 4.1 Run formatting only; do not run the test suite.
- [x] 4.2 Build matching Windows runtime and WebView artifacts.
- [ ] 4.3 Version and publish OpenTray, then update and publish pnpm-pub.
