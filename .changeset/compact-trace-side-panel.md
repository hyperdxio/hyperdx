---
'@hyperdx/app': patch
---

fix: start the trace waterfall higher in the side panel

Trace spans no longer repeat their name in a box under the panel title, or the
service as a chip next to the metadata row that already shows it. The
"⌘/Ctrl + scroll to zoom" hint moves into the timeline's top-left corner
instead of taking its own row. Long span names that the title truncates keep
the box. Log panels keep their body box and service chip.
