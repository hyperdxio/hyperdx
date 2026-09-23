---
'@hyperdx/app': minor
---

Add a "Duplicate" action to the dashboard list menu (grid card and list row).
It creates a copy of the dashboard named "<name> (Copy)" and opens it. Every
tile gets a fresh id so the copy never shares tile ids with the original, and
tile alerts are not carried over, so a one-click copy doesn't silently start
firing the source dashboard's alerts. Layout, tags, filters and the saved
query/range are preserved.
