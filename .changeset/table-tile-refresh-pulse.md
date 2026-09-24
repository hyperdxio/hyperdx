---
'@hyperdx/app': patch
---

fix: keep table tile rows on screen while a dashboard refreshes

A dashboard refresh cleared the table tile and showed "Loading Chart Data..."
until the new result arrived. The tile now keeps its current rows and pulses
while the refetch runs, like the other dashboard tiles.
