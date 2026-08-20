---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/cli': patch
---

Chart formulas are now supported across every API surface that persists or accepts chart configs. The external dashboards API v2 and the MCP `save_dashboard` / `patch_dashboard` tools accept `formulas` (letter-ref arithmetic over the tile's select items, e.g. `A / (A + B) * 100`) and `showOperandSeries` on line, stacked bar, table and number builder tiles, round-trip them through GET/PUT, and validate the expressions on write — unknown series refs, malformed syntax, combining formulas with `asRatio`, multiple formulas on a number tile, and formulas on formula-incapable source kinds (anything other than metric, log, or trace) are all rejected with actionable errors. MCP `query_tile` computes formula columns for both metric and log/trace event tiles, the query-guide prompt documents the feature, and the OpenAPI spec includes the new `Formula` schema. The CLI's dashboard tile pipeline now delegates its number/table config transforms to the shared common-utils implementations, so formula tiles render with operand-hiding behavior identical to the web.
