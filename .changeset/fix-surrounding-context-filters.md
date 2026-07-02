---
"@hyperdx/app": patch
---

Fix Surrounding Context filters for non-OTEL schemas by using the source's serviceNameExpression for the "Service" filter instead of hardcoded ResourceAttributes lookup. Also adds quick event attribute filters that let users toggle attributes from the current event to narrow surrounding context results.
