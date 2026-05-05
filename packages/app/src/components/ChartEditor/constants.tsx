import { ReactNode } from 'react';
import { TIMELINE_EXAMPLE_SQL } from '@hyperdx/common-utils/dist/rawSqlParams';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Code, List, Text } from '@mantine/core';

const TIMESERIES_PLACEHOLDER_SQL = `SELECT
  toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} SECOND) AS ts,
  SeverityText,
  count() AS count
FROM
  $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
  AND $__filters
GROUP BY ts, SeverityText
ORDER BY ts ASC;`;

export const SQL_PLACEHOLDERS: Record<DisplayType, string> = {
  [DisplayType.Line]: TIMESERIES_PLACEHOLDER_SQL,
  [DisplayType.StackedBar]: TIMESERIES_PLACEHOLDER_SQL,
  [DisplayType.Table]: `SELECT
  count()
FROM
  $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
  AND $__filters
LIMIT
  200
  `,
  [DisplayType.Pie]: `SELECT
  ServiceName,
  count()
FROM
  $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
  AND $__filters
GROUP BY ServiceName;`,
  [DisplayType.Number]: `SELECT
  count()
FROM
  $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
  AND $__filters;`,
  [DisplayType.Search]: '',
  [DisplayType.Heatmap]: '',
  [DisplayType.Markdown]: '',
  [DisplayType.Timeline]: TIMELINE_EXAMPLE_SQL,
};

const TIMESERIES_INSTRUCTIONS = (
  <>
    <Text size="xs" fw="bold">
      Result columns are plotted as follows:
    </Text>
    <List size="xs" withPadding spacing={3} mb="xs">
      <List.Item>
        <Text span size="xs" fw={600}>
          Timestamp
        </Text>
        <Text span size="xs">
          {' '}
          — The first <Code fz="xs">Date</Code> or <Code fz="xs">DateTime</Code>{' '}
          column.
        </Text>
      </List.Item>
      <List.Item>
        <Text span size="xs" fw={600}>
          Series Value
        </Text>
        <Text span size="xs">
          {' '}
          — Each numeric column will be plotted as a separate series. These
          columns are generally aggregate function values.
        </Text>
      </List.Item>
      <List.Item>
        <Text span size="xs" fw={600}>
          Group Names
        </Text>
        <Text span size="xs">
          {' '}
          (optional) — Any string, map, or array type result column will be
          treated as a group column. Result rows with different group column
          values will be plotted as separate series.
        </Text>
      </List.Item>
    </List>
  </>
);

export const DISPLAY_TYPE_INSTRUCTIONS: Partial<
  Record<DisplayType, ReactNode>
> = {
  [DisplayType.Line]: TIMESERIES_INSTRUCTIONS,
  [DisplayType.StackedBar]: TIMESERIES_INSTRUCTIONS,
  [DisplayType.Pie]: (
    <>
      <Text size="xs" fw="bold">
        Result columns are plotted as follows:
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            Slice Value
          </Text>
          <Text span size="xs">
            {' '}
            — The first numeric column determines each slice&apos;s size.
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            Slice Label
          </Text>
          <Text span size="xs">
            {' '}
            (optional) — Each unique value of each string, map, and array type
            columns will be used as a slice label.
          </Text>
        </List.Item>
      </List>
    </>
  ),
  [DisplayType.Number]: (
    <>
      <Text size="xs" fw="bold">
        Result columns are displayed as follows:
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            Number
          </Text>
          <Text span size="xs">
            {' '}
            — The value of the first numeric column in the first result row is
            displayed as the number.
          </Text>
        </List.Item>
      </List>
    </>
  ),
  [DisplayType.Timeline]: (
    <>
      <Text size="xs" fw="bold">
        Result columns are rendered as event markers on a time axis:
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            ts
          </Text>
          <Text span size="xs">
            {' '}
            (required) — A <Code fz="xs">DateTime</Code> or{' '}
            <Code fz="xs">DateTime64</Code> column for the event timestamp.
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            label
          </Text>
          <Text span size="xs">
            {' '}
            (required) — A <Code fz="xs">String</Code> column for the marker
            label shown in tooltips.
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            group
          </Text>
          <Text span size="xs">
            {' '}
            (optional) — A <Code fz="xs">String</Code> column to split events
            into separate lanes.
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            severity
          </Text>
          <Text span size="xs">
            {' '}
            (optional) — A <Code fz="xs">String</Code> column for severity-based
            color mapping.
          </Text>
        </List.Item>
      </List>
    </>
  ),
};
