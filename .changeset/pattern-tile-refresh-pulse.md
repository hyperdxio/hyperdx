---
'@hyperdx/app': patch
---

fix: keep pattern tiles on screen while a dashboard refreshes

During a refresh, event pattern tiles dropped their patterns and showed a
loading state until the new sample was mined. They now keep the current
patterns on screen and pulse while the refetch runs, like the other dashboard
tiles.
