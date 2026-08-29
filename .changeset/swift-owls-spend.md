---
"@hyperdx/app": patch
---

fix(charts): honor a configured mantissa on time chart Y-axis tick labels

The Y-axis of a time series chart always rounded tick labels to 0 decimal
places, regardless of the chart's Number Format settings. Charts whose
values live under 1 (fractional gauges, ratios, sub-1 rates) rendered every
axis tick as `0` even though the tooltip and legend showed the correct
value. The axis now respects an explicitly configured mantissa, falling
back to 0 only when none is set.
