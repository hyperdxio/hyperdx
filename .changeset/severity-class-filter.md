---
'@hyperdx/common-utils': minor
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Log sources with a Severity Number Expression get a Severity filter with the
OpenTelemetry classes (TRACE to FATAL, plus OTHER), from SeverityNumber with a
severity text fallback. The severity text filter stays. Kubernetes "Errors" log
tables and LLM error counts match FATAL and ERROR, and alert notifications show
`Severity: ERROR` instead of the filter SQL. Materialized views keyed only on
severity text can't serve this filter; add SeverityNumber to their dimensions.
