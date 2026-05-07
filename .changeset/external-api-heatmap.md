---
'@hyperdx/api': minor
---

feat(api): support heatmap tiles in external dashboards API

Heatmap is the only builder-mode display type that did not round-trip
through the external dashboards API. The serializer dropped it into the
"unsupported" fall-through, so creating, fetching, and updating heatmap
tiles via `/api/v2/dashboards` lost the config. Heatmap now serializes
and parses on both directions, with `valueExpression`,
`countExpression`, `alias`, `heatmapScaleType`, and `numberFormat`
preserved across save/get. Raw-SQL heatmap remains unsupported (heatmap
rendering requires builder mode).
