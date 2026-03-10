import { DisplayType } from '@hyperdx/common-utils/dist/types';

const TIMESERIES_PLACEHOLDER_SQL = `SELECT
  toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} SECOND) AS ts,
  SeverityText,
  count() AS count
FROM
  default.otel_logs
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
GROUP BY ts, SeverityText
ORDER BY ts ASC;`;

export const SQL_PLACEHOLDERS: Record<DisplayType, string> = {
  [DisplayType.Line]: TIMESERIES_PLACEHOLDER_SQL,
  [DisplayType.StackedBar]: TIMESERIES_PLACEHOLDER_SQL,
  [DisplayType.Table]: `SELECT
  count()
FROM
  default.otel_logs
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
LIMIT
  200
  `,
  [DisplayType.Pie]: '',
  [DisplayType.Number]: '',
  [DisplayType.Search]: '',
  [DisplayType.Heatmap]: '',
  [DisplayType.Markdown]: '',
};
