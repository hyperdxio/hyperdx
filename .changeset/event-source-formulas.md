---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

Formulas now work on log and trace sources, not just metrics. Time series, table and number charts on event sources can define derived series via letter-ref arithmetic expressions (e.g. `A / B * 100`), with the same editor controls (Add Formula, series letter badges, Show input series) previously offered only on metric sources. Event formulas compile inline into the chart's single-scan SELECT — no per-series query fan-out — with the same missing-data semantics as the existing events ratio toggle.
