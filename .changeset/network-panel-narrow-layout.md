---
'@hyperdx/app': patch
---

Fix unreadable URLs and header values in the HTTP request panel of the trace
and row side panels. The label column was pinned to 260px in a fixed-layout
table, which is wider than the span detail pane, so the value column collapsed
and rendered one character per line. Those tables now size the label column to
its content and let the value take the remaining width.
