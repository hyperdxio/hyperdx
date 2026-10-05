---
'@hyperdx/app': patch
---

Fix the trace waterfall sticking on the previously opened span when a result is closed and another span of the same trace is opened. Opening a different result clears that span. Closing the result, or opening the result that is already open, leaves the span selected in the waterfall.
