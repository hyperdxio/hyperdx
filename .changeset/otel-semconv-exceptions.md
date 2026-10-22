---
'@hyperdx/app': patch
---

fix: Show the Exception panel for logs and spans that carry `exception.type`,
`exception.message` or `exception.stacktrace` attributes, not only for
`exception` span events; show correlated logs in the trace waterfall even when
their span was never exported, and color error logs and `exception` span events
red there; and set `spanEventsValueExpression` and `spanLinksValueExpression` on
the default trace sources so span exceptions and links load out of the box. The
default sources also gain the summary and exponential histogram metric tables
and drop key rollup tables the schema no longer creates.
