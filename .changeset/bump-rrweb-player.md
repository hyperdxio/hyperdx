---
'@hyperdx/app': patch
---

Upgrade the session replay player from `rrweb@2.0.0-alpha.8` to stable `@rrweb/replay@2.1.1` (the replay-only package rrweb now recommends, since the combined `rrweb` package is deprecated), aligning the replayer with the rrweb version used by current `@hyperdx/browser` recorders and picking up several years of upstream replayer fixes (style-sheet handling, virtual DOM, adopted stylesheets). Replay fidelity was verified for sessions recorded with both `rrweb@1.1.3` (older browser SDKs) and `rrweb@2.1.1` (current SDKs).
