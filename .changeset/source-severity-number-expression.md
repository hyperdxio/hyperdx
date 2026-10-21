---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': minor
---

Add an optional `severityNumberExpression` to log sources, pointing at the
numeric OpenTelemetry SeverityNumber (1-24). Source auto-detection sets it when
an OTel log table has an integer `SeverityNumber` column.
