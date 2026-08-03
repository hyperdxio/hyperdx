---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

feat: Per-tile display settings for time charts

Line and area time charts gain three settings in the tile Display Settings
drawer, persisted on the tile config:

- Show Legend: hide or show the series legend.
- Hover Tooltip: Auto, Single series, All series, or Hidden. Auto keeps the
  density-based behavior (a single-series tooltip on dense charts, the full
  list otherwise); the other values pin the mode.
- Line Style: Linear, Smooth, or Step interpolation for the drawn series.

All three are optional and fall back to the current behavior (legend on, Auto
tooltip, Smooth line) when unset, so existing tiles are unchanged.
