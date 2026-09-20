---
"opentray": patch
---

Transport robustness W4 amendment (consumer field evidence): a supervised recovery now restores each WebView window's settled visibility. The rebuild replay previously re-showed every window as a side effect of replaying the bootstrap, so a hidden retained window (the tray-panel `close()` idiom with `autoHide:false`) popped back open on every recovery. The facade journals the settled visibility op (last successful show/hide/close) and restores it after the style replay, before the snapshot queries — the post-recovery `visibleChange` reports the restored value.
