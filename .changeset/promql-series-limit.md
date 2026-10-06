---
'@hyperdx/app': patch
---

feat: support a series limit on PromQL line, stacked bar, pie and bar charts

The Display Settings drawer now offers Series Limit for PromQL charts. On line and stacked bar charts it keeps the top N series by peak value (leave empty for the default of 250, or set 0 for unlimited). On pie and bar charts it keeps the N largest slices or bars (leave empty to show all).
