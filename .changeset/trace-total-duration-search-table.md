---
'@hyperdx/app': patch
---

feat: show a trace's total wall-clock duration and span count in the trace
waterfall view's controls bar. Previously this required manually eyeballing
the timeline (summing span rows would double-count parallel work).
