---
'@hyperdx/app': patch
---

fix: keep search tile rows on screen while a dashboard refreshes

During a refresh, search tiles dropped their rows and showed a loading state
until the new results arrived. They now keep the current rows on screen and
pulse while the refetch runs, like the other dashboard tiles.
