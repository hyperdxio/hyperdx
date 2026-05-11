---
'@hyperdx/app': minor
'@hyperdx/common-utils': patch
---

feat: heatmap charts in chart editor and dashboards

- Heatmap is now a selectable display type in the chart editor tabs
- Dashboard tiles render heatmaps via the shared `DBHeatmapChart` component
- Heatmap source picker restricted to trace sources; value/count expressions auto-populate from the source's duration expression
- Display Settings drawer (scale, value, count) shared across search Event Deltas, chart editor, and dashboards
- Click a dashboard heatmap tile to open Event Deltas with source, where clause, filters, and time range preserved
- Dynamic Y-axis sizing measures formatted tick labels so long labels (e.g. "1.67min") are not clipped
