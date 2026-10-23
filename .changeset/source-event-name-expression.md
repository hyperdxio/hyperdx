---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': minor
---

Add an optional `eventNameExpression` to log sources, pointing at the
OpenTelemetry log EventName. Source auto-detection sets it when an OTel log
table has a string `EventName` column. The field is stored and editable only:
nothing reads it yet. HDX-5787
