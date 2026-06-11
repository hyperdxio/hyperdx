---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
"@hyperdx/api": patch
---

feat: surface OpenTelemetry span links in the trace view. Trace sources gain an optional `spanLinksValueExpression` field (auto-detected from the OTel `Links` column), and the span detail panel shows a new "Span Links" section listing each linked trace ID, span ID, trace state and attributes.
