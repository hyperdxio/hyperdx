---
'@hyperdx/app': patch
---

fix: keep duration axis-tick labels within the chart's width budget

Duration-formatted Y-axis labels (e.g. "13.33min") could render wider than the axis area allows and get clipped. They now use the same compact formatter already used by the heatmap chart's axis.
