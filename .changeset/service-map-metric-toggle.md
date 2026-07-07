---
"@hyperdx/app": patch
---

Service map: add a dotted canvas background and a metric-mode toggle (Latency /
Error rate / Throughput) that recolors the graph by the selected dimension, with
a legend explaining the color scale and that node size encodes throughput. The
canvas and its controls now follow the app's light/dark color scheme instead of
being locked to dark. Node colors use a sequential light-to-dark ramp per
metric, and the node popover is now a raised surface with a service-name header,
grouped sections, and severity-aware error coloring.
