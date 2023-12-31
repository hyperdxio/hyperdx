import { memo } from 'react';
import Link from 'next/link';
import { Box, Flex, HoverCard, Text } from '@mantine/core';

import api from './api';
import { Granularity, MS_NUMBER_FORMAT } from './ChartUtils';
import type { ChartSeries, NumberFormat } from './types';
import { formatNumber, semanticKeyedColor } from './utils';

function ListItem({
  title,
  value,
  color,
  percent,
  hoverCardContent,
}: {
  title: string;
  value: string;
  color: string;
  percent: number;
  hoverCardContent?: React.ReactNode;
}) {
  const item = (
    <Box>
      <Flex justify="space-between">
        <Text size="sm">{title}</Text>
        <Text size="sm">{value}</Text>
      </Flex>
      <Box pt="xs">
        <Box
          style={{
            width: `${percent}%`,
            height: 8,
            backgroundColor: color,
            borderRadius: 4,
          }}
        />
      </Box>
    </Box>
  );
  return hoverCardContent ? (
    <HoverCard width={280} shadow="md" position="right" withinPortal>
      <HoverCard.Target>{item}</HoverCard.Target>
      <HoverCard.Dropdown>{hoverCardContent}</HoverCard.Dropdown>
    </HoverCard>
  ) : (
    item
  );
}

type Row = {
  group: string[];
  [dataKey: `series_${number}.data`]: number;
};

function ListBar({
  rows,
  getRowSearchLink,
  columns,
}: {
  rows: Row[];
  getRowSearchLink?: (row: Row) => string;
  columns: {
    displayName: string;
    numberFormat?: NumberFormat;
  }[];
}) {
  const values = (rows ?? []).map(row => row['series_0.data']);
  const maxValue = Math.max(...values);
  const totalValue = values.reduce((a, b) => a + b, 0);

  return (
    <>
      {rows?.map(row => {
        const value = row['series_0.data'];
        const percentOfMax = (value / maxValue) * 100;
        const percentOfTotal = (value / totalValue) * 100;
        const group = `${row.group.join(' ').trim()}`;

        const hoverCardContent =
          columns.length > 0 ? (
            <Box>
              <Box mb="xs">
                <Text fw="bold">{group}</Text>
              </Box>
              {columns.map((column, i) => {
                const value = row[`series_${i}.data`];
                return (
                  <Box key={column.displayName} mb="xs">
                    <Text size="xs" weight={500} span>
                      {column.displayName}:{' '}
                    </Text>
                    <Text size="xs" span>
                      {column.numberFormat != null
                        ? formatNumber(value, column.numberFormat) ?? 'N/A'
                        : value}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          ) : null;

        return getRowSearchLink ? (
          <Link href={getRowSearchLink(row)} passHref>
            <Box
              mb="sm"
              key={group}
              component="a"
              td="none"
              className="cursor-pointer"
              display="block"
              c="inherit"
            >
              <ListItem
                title={group}
                value={`${percentOfTotal.toFixed(2)}%`}
                color={semanticKeyedColor(group)}
                percent={percentOfMax}
                hoverCardContent={hoverCardContent}
              />
            </Box>
          </Link>
        ) : (
          <Box mb="sm" key={group}>
            <ListItem
              title={group}
              value={`${percentOfTotal.toFixed(2)}%`}
              color={semanticKeyedColor(group)}
              percent={percentOfMax}
              hoverCardContent={hoverCardContent}
            />
          </Box>
        );
      })}
    </>
  );
}

const HDXListBarChart = memo(
  ({
    config: { series, seriesReturnType = 'column', dateRange },
    getRowSearchLink,
  }: {
    config: {
      series: [ChartSeries];
      granularity: Granularity;
      dateRange: [Date, Date];
      seriesReturnType?: 'ratio' | 'column';
      numberFormat?: NumberFormat;
      groupColumnName?: string;
    };
    onSettled?: () => void;
    getRowSearchLink?: (row: Row) => string;
  }) => {
    const { data, isError, isLoading } = api.useMultiSeriesChart({
      series,
      endDate: dateRange[1] ?? new Date(),
      startDate: dateRange[0] ?? new Date(),
      seriesReturnType,
    });

    const rows: any[] = data?.data ?? [];

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : data?.data?.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <Box className="overflow-auto" h="100%">
        <ListBar rows={rows} getRowSearchLink={getRowSearchLink} columns={[]} />
      </Box>
    );
  },
);

export const HDXSpanPerformanceBarChart = memo(
  ({
    config: { spanName, parentSpanWhere, childrenSpanWhere, dateRange },
  }: {
    config: {
      spanName: string;
      parentSpanWhere: string;
      childrenSpanWhere: string;
      dateRange: [Date, Date];
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } = api.useSpanPerformanceChart({
      parentSpanWhere,
      childrenSpanWhere,
      endDate: dateRange[1] ?? new Date(),
      startDate: dateRange[0] ?? new Date(),
    });

    const rows: any[] =
      data?.data?.filter(row => {
        return row.group[0] != spanName;
      }) ?? [];

    const getRowSearchLink = (row: Row) => {
      const urlQ =
        row.group.length > 1 && row.group[1]
          ? ` (http.host:"${row.group[1]}" OR server.address:"${row.group[1]}")`
          : '';
      const qparams = new URLSearchParams({
        q: `${childrenSpanWhere} span_name:"${row.group[0]}"${urlQ}`.trim(),
        from: `${dateRange[0].getTime()}`,
        to: `${dateRange[1].getTime()}`,
      });
      return `/search?${qparams.toString()}`;
    };

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : data?.data?.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <Box className="overflow-auto" h="100%">
        <ListBar
          rows={rows}
          getRowSearchLink={getRowSearchLink}
          columns={[
            {
              displayName: 'Total Time Spent',
              numberFormat: MS_NUMBER_FORMAT,
            },
            {
              displayName: 'Number of Calls',
            },
            {
              displayName: 'Average Duration',
              numberFormat: MS_NUMBER_FORMAT,
            },
            {
              displayName: 'Min Duration',
              numberFormat: MS_NUMBER_FORMAT,
            },
            {
              displayName: 'Max Duration',
              numberFormat: MS_NUMBER_FORMAT,
            },
            {
              displayName: 'Number of Requests',
            },
            {
              displayName: 'Calls per Request',
            },
          ]}
        />
      </Box>
    );
  },
);

export default HDXListBarChart;
