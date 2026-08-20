---
'@hyperdx/common-utils': patch
---

Number charts on metric formula configs always hide their operand series: `convertToNumberChartConfig` forces `showOperandSeries: false` when formulas are present, so the number tile renders the formula column rather than the first raw operand — regardless of the tile's "Show input series" setting on other display types or when a formula chart is switched to the Number display type.
