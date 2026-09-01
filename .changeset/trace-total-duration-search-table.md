---
'@hyperdx/app': patch
---

feat: show a trace's total wall-clock duration and span count in the Search
results stats row when viewing a single trace. Users no longer have to open the
waterfall to see end-to-end duration (summing span rows would double-count
parallel work).
