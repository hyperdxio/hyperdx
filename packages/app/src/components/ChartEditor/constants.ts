import { DisplayType } from '@hyperdx/common-utils/dist/types';

export const SQL_PLACEHOLDERS: Record<DisplayType, string> = {
  [DisplayType.Line]: '',
  [DisplayType.StackedBar]: '',
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
