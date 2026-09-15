---
"create-opentray": patch
"@opentray/ext-webview": patch
---

Complete the walkthrough fix family released in 0.27.5: document-navigation channel closes now push through the extension EventPort (a manual toolbar reload restores the address bar and self-heals the channel instead of stranding it until an unrelated command), every typed-fail exit of the page channel commands submits pending host events before returning, and the generated shell server suppresses the toolbar context menu everywhere except text-entry elements.
