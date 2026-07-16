# termchart

Pure ANSI terminal chart renderers. Every renderer is a pure function —
shaped data plus target dimensions in, a string containing ANSI escape
codes out — with no Ink / React / process / terminal dependencies, so the
same functions serve interactive TUIs and non-interactive stdout commands
(and are trivially unit-testable by asserting on strings).

The module is self-contained: the only runtime dependency is `chalk`.
Nothing in here may import from the rest of the CLI — application-specific
concerns (query shaping, number-format schemas) stay outside and plug in
through data types and formatter callbacks.

## Renderers

| Function                 | Output                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `renderLineChart`        | Multi-series line chart with nice-tick y-axis, time x-axis, legend |
| `renderStackedBarChart`  | Stacked column chart, one column per time bucket               |
| `renderCategoricalChart` | Horizontal bars per category (bar / pie), optional percentages |
| `renderNumberChart`      | A single pre-formatted value, centered                         |
| `renderTableChart`       | Column-aligned table, numeric right-alignment, row capping     |
| `renderMarkdown`         | Minimal markdown (bolded headers)                              |

Supporting API: `stripAnsi` (clean output for pipes/agents), `niceTicks`
(1/2/2.5/5×10ⁿ axis domains), `resampleSeries` (peak-preserving width
resampling), `resampleLinear` (for linear axes like timestamps),
`defaultFormatValue` (compact number formatting), `renderLegend`,
`renderTimeAxis`.

## Design notes

- **Peak-preserving resampling**: charts stretch to the terminal width by
  pinning every bucket value exactly at its nearest column (upscale) or
  keeping each column range's max-magnitude value (downscale). Plain
  linear resampling samples *between* buckets, attenuating narrow spikes
  (a 0→1→0 spike renders as ~0.94) — never do that to data.
- **Nice y-axes**: domains are pinned at zero with the top rounded up to a
  1/2/2.5/5×10ⁿ tick boundary and only tick rows labeled — like axis tick
  generation in mainstream charting libraries — instead of labeling every
  row with raw fractions of the data range.
- **Formatting is injected**: renderers accept `formatTick` /
  `formatValue` / `formatNumericCell` callbacks so callers control units
  (durations, bytes, percentages) without this module knowing about any
  particular format schema.

## Provenance

The line plotter is currently backed by
[asciichart](https://github.com/kroitor/asciichart) (MIT).
