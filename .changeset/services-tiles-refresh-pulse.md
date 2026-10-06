---
'@hyperdx/app': patch
---

fix: pulse the list-bar and histogram charts while they refresh

The Services dashboard's list-bar and latency histogram charts kept their
previous data during a refresh but gave no sign that new data was loading,
and the histogram could briefly swap its chart for "Loading Chart Data...".
Both now keep their previous data on screen and pulse while the refetch runs,
like the other charts.
