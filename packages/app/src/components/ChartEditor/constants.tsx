import { ReactNode } from 'react';
import { Trans } from 'next-i18next/pages';
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
};

const TIMESERIES_INSTRUCTIONS = (
  <>
    <Text size="xs" fw="bold">
      <Trans>Result columns are plotted as follows:</Trans>
    </Text>
    <List size="xs" withPadding spacing={3} mb="xs">
      <List.Item>
        <Text span size="xs" fw={600}>
          <Trans>Timestamp</Trans>
        </Text>
        <Text span size="xs">
          {' '}
          <Trans>— The first</Trans>{' '}
          <Code fz="xs">
            <Trans>Date</Trans>
          </Code>{' '}
          <Trans>or</Trans>{' '}
          <Code fz="xs">
            <Trans>DateTime</Trans>
          </Code>{' '}
          <Trans>column.</Trans>
        </Text>
      </List.Item>
      <List.Item>
        <Text span size="xs" fw={600}>
          <Trans>Series Value</Trans>
        </Text>
        <Text span size="xs">
          {' '}
          <Trans>
            — Each numeric column will be plotted as a separate series. These
            columns are generally aggregate function values.
          </Trans>
        </Text>
      </List.Item>
      <List.Item>
        <Text span size="xs" fw={600}>
          <Trans>Group Names</Trans>
        </Text>
        <Text span size="xs">
          {' '}
          <Trans>
            (optional) — Any string, map, or array type result column will be
            treated as a group column. Result rows with different group column
            values will be plotted as separate series.
          </Trans>
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
        <Trans>Result columns are plotted as follows:</Trans>
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            <Trans>Slice Value</Trans>
          </Text>
          <Text span size="xs">
            {' '}
            <Trans>
              — The first numeric column determines each slice's size.
            </Trans>
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            <Trans>Slice Label</Trans>
          </Text>
          <Text span size="xs">
            {' '}
            <Trans>
              (optional) — Each unique value of each string, map, and array type
              columns will be used as a slice label.
            </Trans>
          </Text>
        </List.Item>
      </List>
    </>
  ),
  [DisplayType.Number]: (
    <>
      <Text size="xs" fw="bold">
        <Trans>Result columns are displayed as follows:</Trans>
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            <Trans>Number</Trans>
          </Text>
          <Text span size="xs">
            {' '}
            <Trans>
              — The value of the first numeric column in the first result row is
              displayed as the number.
            </Trans>
          </Text>
        </List.Item>
      </List>
    </>
  ),
};
