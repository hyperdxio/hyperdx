---
'@hyperdx/app': patch
---

feat: Improve time chart hover for dense charts

- Line and area charts with more than 10 visible series now show a single-series
  hover tooltip: only the series nearest the cursor, instead of a tall list of
  every series that is impossible to read and never the one being pointed at.
  Filtering the legend down to fewer series brings the full list back, and
  stacked bars keep the full tooltip.
- The hovered series is emphasized by a dedicated line drawn on top, so it is
  never hidden behind another line that happens to share its values. The other
  lines dim via one CSS class instead of re-rendering every line on each cursor
  move.
- Synced charts highlight the same series by name: hovering a line on one chart
  surfaces that series on the others, and a chart that does not have it shows
  only the shared time cursor.
