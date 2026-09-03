---
"@hyperdx/app": patch
"@hyperdx/cli": patch
---

fix(charts): show decimals on Y-axis ticks under 10 in magnitude

The Y-axis of a time series chart (and the CLI's termchart equivalent)
always rounded tick labels to 0 decimal places, regardless of the chart's
Number Format settings. Charts whose values live under 1 (fractional
gauges, ratios, sub-1 rates) rendered every axis tick as `0` even though
the tooltip and legend showed the correct value.

A tick under 10 in magnitude (as displayed - a percent tick's magnitude is
checked against its ×100 value, not its raw 0-1 ratio) now honors the
chart's configured decimals, capped at 2 to keep the label within the
axis's fixed width. A tick of 10 or more, and a tick of exactly 0, stay
integers exactly as before, whatever the chart's Number Format configures
- so ordinary counts and the byte/percent tiles in the bundled dashboard
templates are unaffected.
