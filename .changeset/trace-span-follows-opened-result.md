---
'@hyperdx/app': patch
---

Fix the trace waterfall sticking on the previously opened span when a result is closed and another span of the same trace is opened. Opening a different result clears the span selected in the waterfall. Opening the result that is already open leaves that selection in place.
