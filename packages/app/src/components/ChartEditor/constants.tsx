import { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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

const SINGLE_SERIES_GROUPED_PLACEHOLDER_SQL = `SELECT
  ServiceName,
  count()
FROM
  $__sourceTable
WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
  AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
  AND $__filters
GROUP BY ServiceName;`;

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
  [DisplayType.Pie]: SINGLE_SERIES_GROUPED_PLACEHOLDER_SQL,
  [DisplayType.Bar]: SINGLE_SERIES_GROUPED_PLACEHOLDER_SQL,
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
  [DisplayType.EventPatterns]: '',
};

export function useDisplayTypeInstructions(): Partial<
  Record<DisplayType, ReactNode>
> {
  const { t } = useTranslation('charts');

  const timeseriesInstructions = (
    <>
      <Text size="xs" fw="bold">
        {t('resultColumns.plottedAs')}
      </Text>
      <List size="xs" withPadding spacing={3} mb="xs">
        <List.Item>
          <Text span size="xs" fw={600}>
            {t('resultColumns.timestampLabel')}
          </Text>
          <Text span size="xs">
            {' '}
            <Trans
              t={t}
              i18nKey="resultColumns.timestampDesc"
              components={{ code: <Code fz="xs" /> }}
            />
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            {t('resultColumns.seriesValueLabel')}
          </Text>
          <Text span size="xs">
            {' '}
            {t('resultColumns.seriesValueDesc')}
          </Text>
        </List.Item>
        <List.Item>
          <Text span size="xs" fw={600}>
            {t('resultColumns.groupNamesLabel')}
          </Text>
          <Text span size="xs">
            {' '}
            {t('resultColumns.groupNamesDesc')}
          </Text>
        </List.Item>
      </List>
    </>
  );

  return {
    [DisplayType.Line]: timeseriesInstructions,
    [DisplayType.StackedBar]: timeseriesInstructions,
    [DisplayType.Pie]: (
      <>
        <Text size="xs" fw="bold">
          {t('resultColumns.plottedAs')}
        </Text>
        <List size="xs" withPadding spacing={3} mb="xs">
          <List.Item>
            <Text span size="xs" fw={600}>
              {t('resultColumns.sliceValueLabel')}
            </Text>
            <Text span size="xs">
              {' '}
              {t('resultColumns.sliceValueDesc')}
            </Text>
          </List.Item>
          <List.Item>
            <Text span size="xs" fw={600}>
              {t('resultColumns.sliceLabelLabel')}
            </Text>
            <Text span size="xs">
              {' '}
              {t('resultColumns.sliceLabelDesc')}
            </Text>
          </List.Item>
        </List>
      </>
    ),
    [DisplayType.Bar]: (
      <>
        <Text size="xs" fw="bold">
          {t('resultColumns.plottedAs')}
        </Text>
        <List size="xs" withPadding spacing={3} mb="xs">
          <List.Item>
            <Text span size="xs" fw={600}>
              {t('resultColumns.barValueLabel')}
            </Text>
            <Text span size="xs">
              {' '}
              {t('resultColumns.barValueDesc')}
            </Text>
          </List.Item>
          <List.Item>
            <Text span size="xs" fw={600}>
              {t('resultColumns.barLabelLabel')}
            </Text>
            <Text span size="xs">
              {' '}
              {t('resultColumns.barLabelDesc')}
            </Text>
          </List.Item>
        </List>
      </>
    ),
    [DisplayType.Number]: (
      <>
        <Text size="xs" fw="bold">
          {t('resultColumns.displayedAs')}
        </Text>
        <List size="xs" withPadding spacing={3} mb="xs">
          <List.Item>
            <Text span size="xs" fw={600}>
              {t('resultColumns.numberLabel')}
            </Text>
            <Text span size="xs">
              {' '}
              {t('resultColumns.numberDesc')}
            </Text>
          </List.Item>
        </List>
      </>
    ),
  };
}
