---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
"@hyperdx/api": patch
---

feat: surface OpenTelemetry span links in the trace view. Trace sources gain an optional `spanLinksValueExpression` field (auto-detected from the OTel `Links` column), and the span detail panel shows a new "Span Links" section. Each link has an "Open trace" action that opens the linked trace in a stacked panel, with its trace state and attributes shown as chips.
