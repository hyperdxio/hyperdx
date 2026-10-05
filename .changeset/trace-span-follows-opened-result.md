---
'@hyperdx/app': patch
---

Fix the trace waterfall sticking on the previously opened span when a result is closed and another span of the same trace is opened. The span selected in the waterfall is cleared with the result, unless the result being opened is that span.
