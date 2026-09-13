---
"create-opentray": patch
---

Browser-normal webview defaults: content webviews now identify as a standard browser by default, fixing reload loops on UA-sniffing sites (baidu.com was the reported casualty).

- New per-webview `browser` options on `createWebview` / `createWebviewWindow({ webviews })`: `userAgent` (full override), `browserlikeUserAgent` (default `true` — macOS appends the standard `Version/… Safari/…` tokens through Apple's public `applicationNameForUserAgent` hook; Windows already ships a full Edge UA so shaping is a no-op), `incognito` (default `false`, persistent profile; macOS), and `autoplay` (default `false`).
- Diagnosis evidence: the bare WKWebView UA (`…AppleWebKit/… (KHTML, like Gecko)` with no browser token) drove portal homepages into a same-URL reload loop (~10/s); with the browserlike default the same window settles after its normal load chain (200+ → 4 navigations per 20s). Cookies and localStorage were proven healthy on real http origins — the loop was UA-detection, not storage.
