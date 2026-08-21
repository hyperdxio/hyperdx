---
'@hyperdx/app': minor
---

Add metric formula editing to the chart editor. Metric-source charts (time series, table, number) gain an "Add Formula" row: a letter-ref arithmetic expression over the chart's series (`A` = series 1, `B` = series 2, ...) such as `A / (A + B) * 100`, with inline structured validation (malformed expressions, unknown series references), per-formula alias and number format, and a "Show input series" toggle to render only the formula column(s) or the formula alongside its operand series. Series rows now carry their reference letter as a badge. Formulas and the "As Ratio" toggle are mutually exclusive, and formulas persist on dashboard tiles and standalone charts.
