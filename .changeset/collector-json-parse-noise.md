---
'@hyperdx/otel-collector': patch
---

Stop the collector logging a `ParseJSON` syntax error for every log body that
contains braces but isn't JSON (e.g. Go struct or Python dict dumps). JSON
extraction now only matches objects that start with a quoted key, and remaining
parse failures in that statement group are silenced.
