---
'@hyperdx/app': patch
---

feat: show a trace's total wall-clock duration in the waterfall controls bar
(earliest span start to latest span end). Previously this required eyeballing
the timeline; summing span rows would double-count parallel work. If a fetch
window exceeds the row cap, the figure is marked as a lower bound.
