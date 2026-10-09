---
'@hyperdx/app': patch
---

Fix the trace waterfall sticking on the previously opened span when another span of the same trace is opened, including from a session replay. Closing the result clears the selected span. Opening a different result selects that result's span, including when the waterfall stays mounted on cached data.
