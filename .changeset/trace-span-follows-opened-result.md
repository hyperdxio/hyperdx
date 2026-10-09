---
'@hyperdx/app': patch
---

Fix the trace waterfall sticking on the previously opened span when another span of the same trace is opened. Closing the result clears the selected span. Opening a different result while the drawer stays open selects that result's span.
