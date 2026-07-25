---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat: surface OpenTelemetry span links in the trace view. Trace sources gain an
optional `spanLinksValueExpression` field (auto-detected from the OTel `Links`
column), and the span detail panel shows a new "Span Links" section. Each link
has an "Open trace" action that opens the linked trace in place in the same
panel, with a breadcrumb trail you can step back through, and shows the link's
trace state and attributes as chips.
