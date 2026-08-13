---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

Multi-series metric charts now run as a single composed ClickHouse query instead of one query per series joined client-side. The per-series queries are combined via UNION ALL and pivoted back into one row per (group, time bucket) in SQL, including ratio charts (`seriesReturnType: 'ratio'`) and both `ratioMode` variants, which previously divided the two result sets in the browser/node. Result shape, column naming (including same-alias `__{index}` disambiguation), gap semantics, and ratio semantics are unchanged; charts with many series render with fewer round trips, and "View SQL" for multi-series metric charts now shows the full query instead of only the first series.
