---
'@hyperdx/app': patch
---

Fix the Search page using more and more browser memory with Live Tail on. Each
refresh added CSS rules for the SELECT and ORDER BY editors that were never
removed, so a tab left open could grow by gigabytes.
