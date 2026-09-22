---
'@hyperdx/app': patch
---

fix: warn when a trace/span ID expression is a literal value

Pasting a trace ID into the source form's **Trace Id Expression** was reported
as "Expression is valid" — ClickHouse happily accepts a constant in a `SELECT`
— and only failed later when the row side panel built a query around it. Those
two fields now show a warning when the expression is a hard-coded value (a
quoted string, a number, or either carrying an alias) instead of a column
reference.
