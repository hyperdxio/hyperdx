---
"@hyperdx/app": minor
---

chore(charts): upgrade Recharts from 2.13 to 3.x. Reworks chart event handlers
to the Recharts 3 event API (zoom-brush selection, click drill-down), replaces
the histogram's imperative `chart.setState` tooltip-pin hack with the controlled
`active`/`defaultIndex` Tooltip props, updates custom tooltip/shape typings
(`TooltipContentProps`, `BarProps`), and suppresses the browser focus ring that
Recharts 3's default `accessibilityLayer` shows when a chart is clicked.
