---
'@hyperdx/app': patch
---

When a log source sets Severity Number Expression, log levels follow the
OpenTelemetry SeverityNumber (1-24) in the row side panel, the search results
and pattern table level cells, the pattern trend bars, and the trace waterfall's
log error and warning flags. Levels show the spec's short name, such as `INFO2`,
add the stored text in parentheses when it differs, as in
`INFO (Informational)`, and take their color from the number. The search results
and pattern table use the number only when the expression names a stored numeric
column. Copy and filter actions still use the stored text. Rows without a number
in 1-24, and sources without the field, show the stored text as before. Level
labels and the waterfall flags also treat `panic`, `dpanic`, `ftl` and `severe`
as errors and `wrn` as a warning.
