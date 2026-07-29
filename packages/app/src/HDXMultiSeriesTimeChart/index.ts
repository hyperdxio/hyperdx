/**
 * Public surface of the multi-series time chart. Split out of a single
 * 1500-line module; consumers (and the tests that
 * `jest.mock('@/HDXMultiSeriesTimeChart')`) import from here, so the internal
 * file layout stays free to change.
 */
export {
  type ActiveClickPayload,
  type ActiveClickSeries,
  buildActiveClickSeries,
  getVisibleLineData,
  HARD_LINES_LIMIT,
} from './chartData';
export { collectMemoChartGradientHexes, MemoChart } from './MemoChart';
export { TooltipItem } from './TooltipItem';
