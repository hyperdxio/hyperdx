/**
 * termchart — pure ANSI terminal chart renderers.
 *
 * Self-contained module (only dependency: chalk). Each renderer takes
 * shaped data plus target dimensions and returns a string containing
 * ANSI escape codes — no Ink / process / terminal dependencies — so the
 * same functions serve interactive TUIs and non-interactive stdout
 * commands alike. See README.md for the API overview.
 */

export { defaultFormatValue, stripAnsi } from '@/termchart/ansi';
export {
  renderCategoricalChart,
  renderMarkdown,
  renderNumberChart,
  renderTableChart,
} from '@/termchart/charts';
export { niceTicks, resampleSeries } from '@/termchart/scale';
export {
  renderLineChart,
  renderStackedBarChart,
} from '@/termchart/timeseries';
export type {
  CategoricalEntry,
  TableColumn,
  TimeChartData,
  TimeChartSeries,
} from '@/termchart/types';
