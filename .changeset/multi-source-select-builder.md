---
'@hyperdx/common-utils': minor
---

Add a builder for search queries that project a canonical, source-independent
column set. Given a source, it emits that source's semantic expressions
(timestamp, service, severity/status, body/span name, duration) under shared
aliases, and pads columns a source doesn't have with NULL, so results from
different tables share one shape.
