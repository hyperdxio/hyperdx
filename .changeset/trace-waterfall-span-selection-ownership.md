---
'@hyperdx/app': patch
---

fix: keep the trace waterfall's side panel on the span you clicked

Clicking a span row sometimes left the detail panel showing a previously
selected span, and the wrong span could persist across a reload. The selection
was stored only in the `eventRowWhere` URL param, and URL writes are committed
asynchronously through the Next router — a commit landing out of order re-derived
the selection from a stale URL and snapped the panel back. The waterfall now
owns the selection itself and treats the URL as a projection of it, so a click
always wins; deep links, reloads and Back/Forward keep working.
