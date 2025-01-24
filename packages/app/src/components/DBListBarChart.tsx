import { useMemo } from 'react';
import Link from 'next/link';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Flex, HoverCard, Text } from '@mantine/core';
import { FloatingPosition } from '@mantine/core/lib/components/Floating';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import type { NumberFormat } from '@/types';
import { omit } from '@/utils';
import { formatNumber, semanticKeyedColor } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';

function ListItem({
  title,
  value,
  color,
  percent,
  hoverCardContent,
  hoverCardPosition = 'right',
}: {
  title: string;
  value: string;
  color: string;
  percent: number;
  hoverCardContent?: React.ReactNode;
  hoverCardPosition?: FloatingPosition;
}) {
  const item = (
    <Box>
      <Flex justify="space-between">
        <Text
          size="sm"
          style={{ overflowWrap: 'anywhere' }}
          pr="xs"
          lineClamp={2}
        >
          {title}
        </Text>
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
    <HoverCard
      width={380}
      shadow="md"
      position={hoverCardPosition}
      withinPortal
    >
      <HoverCard.Target>{item}</HoverCard.Target>
      <HoverCard.Dropdown>{hoverCardContent}</HoverCard.Dropdown>
    </HoverCard>
  ) : (
    item
  );
}

function ListBar({
  data,
  valueColumn,
  groupColumn,
  getRowSearchLink,
  columns,
  hoverCardPosition,
}: {
  data: any[];
  valueColumn: string;
  groupColumn: string;
  getRowSearchLink?: (row: any) => string;
  columns: {
    dataKey: string;
    displayName: string;
    numberFormat?: NumberFormat;
    visible?: boolean;
  }[];
  hoverCardPosition?: FloatingPosition;
}) {
  const values = (data ?? []).map(row => row[valueColumn]);
  const maxValue = Math.max(...values);
  const totalValue = values.reduce((a, b) => a + b, 0);

  return (
    <>
      {data?.map((row, index) => {
        const value = row[valueColumn];
        const percentOfMax = (value / maxValue) * 100;
        const percentOfTotal = (value / totalValue) * 100;
        const group = `${row[groupColumn] || 'N/A'}`;

        const hoverCardContent =
          columns.length > 0 ? (
            <Box>
              <Box mb="xs">
                <Text
                  size="xs"
                  style={{ overflowWrap: 'anywhere' }}
                  lineClamp={4}
                >
                  {group}
                </Text>
              </Box>
              {columns
                .filter(c => c.visible !== false && c.dataKey !== groupColumn)
                .map(column => {
                  const value = row[column.dataKey];
                  return (
                    <Box key={column.displayName}>
                      <Text size="xs" fw={500} span>
                        {column.displayName}:{' '}
                      </Text>
                      <Text size="xs" span>
                        {column.numberFormat != null
                          ? (formatNumber(value, column.numberFormat) ?? 'N/A')
                          : value}
                      </Text>
                    </Box>
                  );
                })}
            </Box>
          ) : null;

        return getRowSearchLink ? (
          <Link
            href={getRowSearchLink(row)}
            passHref
            legacyBehavior
            key={group}
          >
            <Box
              mb="sm"
              td="none"
              className="cursor-pointer"
              display="block"
              c="inherit"
            >
              <ListItem
                title={group}
                value={`${percentOfTotal.toFixed(2)}%`}
                color={semanticKeyedColor(group, index)}
                percent={percentOfMax}
                hoverCardContent={hoverCardContent}
                hoverCardPosition={hoverCardPosition}
              />
            </Box>
          </Link>
        ) : (
          <Box mb="sm" key={group}>
            <ListItem
              title={group}
              value={`${percentOfTotal.toFixed(2)}%`}
              color={semanticKeyedColor(group, index)}
              percent={percentOfMax}
              hoverCardContent={hoverCardContent}
              hoverCardPosition={hoverCardPosition}
            />
          </Box>
        );
      })}
    </>
  );
}

export default function DBListBarChart({
  config,
  getRowSearchLink,
  hoverCardPosition,
  queryKeyPrefix,
  enabled,
  valueColumn,
  groupColumn,
}: {
  config: ChartConfigWithDateRange;
  onSettled?: () => void;
  getRowSearchLink?: (row: any) => string;
  hoverCardPosition?: FloatingPosition;
  queryKeyPrefix?: string;
  enabled?: boolean;
  valueColumn: string;
  groupColumn: string;
}) {
  const queriedConfig = omit(config, ['granularity']);
  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  const columns = useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }

    return Object.keys(rows?.[0]).map(key => ({
      dataKey: key,
      displayName: key,
      numberFormat: config.numberFormat,
    }));
  }, [config.numberFormat, data]);

  return isLoading && !data ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      Loading Chart Data...
    </div>
  ) : isError ? (
    <div className="h-100 w-100 align-items-center justify-content-center text-muted">
      <Text ta="center" size="sm" mt="sm">
        Error loading chart, please check your query or try again later.
      </Text>
      <Box mt="sm">
        <Text my="sm" size="sm" ta="center">
          Error Message:
        </Text>
        <Code
          block
          style={{
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
        </Code>
        {error instanceof ClickHouseQueryError && (
          <>
            <Text my="sm" size="sm" ta="center">
              Sent Query:
            </Text>
            <SQLPreview data={error?.query} />
          </>
        )}
      </Box>
    </div>
  ) : data?.data.length === 0 ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      No data found within time range.
    </div>
  ) : (
    <ListBar
      data={data?.data ?? []}
      columns={columns}
      getRowSearchLink={getRowSearchLink}
      hoverCardPosition={hoverCardPosition}
      groupColumn={groupColumn}
      valueColumn={valueColumn}
    />
  );
}
