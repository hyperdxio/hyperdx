---
'@hyperdx/app': patch
---

fix: stop the demo server connect from reporting its own sources as missing

Connecting to the demo server deleted every `Demo*`/`ClickPy*` source before recreating it, so the source list briefly held none of the ids the page was already pointing at and a live source was reported as renamed or deleted. The demo sources are now written over the same-named ones in place, and stale leftovers are pruned only once the current set is in place. Source ids also stay stable when the demo config changes, so existing links keep working.
