---
'@hyperdx/app': patch
---

refactor: drop the instance-label MutationObserver, set the title directly on every page instead

Every page that renders its own `<title>` now composes the instance-label suffix into it directly via `getTitleSuffix()`, removing the DOM-watching side effect that previously patched titles in after the fact.
