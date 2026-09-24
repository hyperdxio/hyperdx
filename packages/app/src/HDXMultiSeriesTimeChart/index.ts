/**
 * Public surface of the multi-series time chart. Split out of a single
 * 1500-line module; consumers (and the tests that
 * `jest.mock('@/HDXMultiSeriesTimeChart')`) import from here, so the internal
 * file layout stays free to change.
 */
export { formatAxisTick, getYAxisTicks } from './axisTicks';
export {
  type ActiveClickPayload,
  type ActiveClickSeries,
  buildActiveClickSeries,
  getSelectedLineData,
  getVisibleLineData,
  getVisibleTooltipRows,
  HARD_LINES_LIMIT,
  sameActiveClickSeries,
} from './chartData';
export { MAX_TOOLTIP_ROWS, TOOLTIP_POINT_OFFSET_PX } from './constants';
export { collectMemoChartGradientHexes, MemoChart } from './MemoChart';
export { TooltipItem } from './TooltipItem';
