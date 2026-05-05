/**
 * @hyperdx/chart-presenters
 *
 * Pure React presenter components for HyperDX charts. Designed to be shared
 * across:
 *   - the dashboard (`packages/app`), which wraps presenters with data
 *     hooks and rich interactions
 *   - the MCP Apps widget (`packages/mcp-widget`), which renders presenters
 *     bare from `structuredContent` payloads pushed by the host
 *
 * Constraints:
 *   - No data fetching (callers wire their own).
 *   - No Mantine / Jotai / Next router (would balloon the widget bundle and
 *     break inside MCP Apps sandboxed iframes).
 *   - Recharts and React are peer dependencies; callers install them.
 */
export {
  TimeSeriesView,
  HARD_LINES_LIMIT,
  type SeriesDescriptor,
  type TimeSeriesDataRow,
  type TimeSeriesDisplayType,
  type TimeSeriesViewProps,
  type FormatNumberFn,
  type FormatTimeFn,
} from './TimeSeriesView';
