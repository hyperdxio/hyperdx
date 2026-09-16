---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

feat: plot several PromQL expressions on one chart

A PromQL tile used to hold exactly one expression, so comparing two of them
meant two tiles side by side. Time series tiles now hold a list: "Add
expression" appends a row, each row carries its own optional alias and legend
template, and every expression is queried separately and listed in the
Generated PromQL preview. An alias prefixes the series names its expression
produces (`errors · service="api"`), and a row's legend template overrides the
chart-level one in Display Settings. The other display types still plot the
first expression and mark the rest as not queried. Existing single-expression
tiles keep working and load into the first row.
