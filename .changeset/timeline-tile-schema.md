---
'@hyperdx/common-utils': minor
---

feat(schema): add Timeline display type and TimelineSeriesSchema

Adds `DisplayType.Timeline` to the shared enum alongside `TimelineSeriesSchema`
and `TimelineSeries` types. Updates all exhaustive `Record<DisplayType, ...>` maps
in `rawSqlParams.ts` and `ChartEditor/constants.tsx`. External API routes Timeline
to the same unsupported-type path as Heatmap.

This is a schema-only PR. The renderer, builder editor, and dashboard wiring
follow in separate PRs.
