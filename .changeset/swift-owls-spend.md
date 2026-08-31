---
"@hyperdx/app": patch
---

fix(charts): show decimals on time chart Y-axis ticks under 1

The Y-axis of a time series chart always rounded tick labels to 0 decimal
places, regardless of the chart's Number Format settings. Charts whose
values live under 1 (fractional gauges, ratios, sub-1 rates) rendered every
axis tick as `0` even though the tooltip and legend showed the correct
value. A tick under 1 now honors the chart's configured decimals, capped at
2 to keep the label within the axis's fixed width. A tick of 1 or more stays
an integer exactly as before, whatever the chart's Number Format configures,
so ordinary counts and the byte/percent tiles in the bundled dashboard
templates are unaffected.
