import { useCallback } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import type { Filter, TSource } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Group, Text } from '@mantine/core';

import { ChartBox } from '@/components/ChartBox';
import DBRowSidePanel from '@/components/DBRowSidePanel';
import { DBSqlRowTable } from '@/components/DBRowTable';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useJsonColumns } from '@/hooks/useMetadata';
import { getExpressions } from '@/serviceDashboard';
import { useSource } from '@/source';

import { SQLPreview } from './ChartSQLPreview';

export default function SlowestEventsTile({
  source,
  dateRange,
  height = 350,
  title,
  queryKeyPrefix,
  enabled = true,
  extraFilters = [],
}: {
  source: TSource;
  dateRange: [Date, Date];
  height?: number;
  title: React.ReactNode;
  queryKeyPrefix?: string;
  enabled?: boolean;
  extraFilters?: Filter[];
}) {
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const [rowId, setRowId] = useQueryState('rowId', parseAsString);
  const [rowSource, setRowSource] = useQueryState('rowSource', parseAsString);
  const { data: rowSidePanelSource } = useSource({ id: rowSource || '' });

  const handleSidePanelClose = useCallback(() => {
    setRowId(null);
    setRowSource(null);
  }, [setRowId, setRowSource]);

  const handleRowExpandClick = useCallback(
    (rowWhere: string) => {
      setRowId(rowWhere);
      setRowSource(source.id);
    },
    [source.id, setRowId, setRowSource],
  );

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    {
      ...source,
      where: '',
      whereLanguage: 'sql',
      select: [
        {
          alias: 'p95',
          aggFn: 'quantile',
          aggCondition: '',
          valueExpression: expressions.durationInMillis,
          level: 0.95,
        },
      ],
      dateRange,
      filters: [...extraFilters],
    },
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, source],
      enabled,
    },
  );

  const p95 = data?.data?.[0]?.['p95'];
  const roundedP95 = Math.round(p95 ?? 0);

  return (
    <ChartBox style={{ height }}>
      <Group justify="space-between" align="center" mb="sm">
        <Text size="sm" c="gray.4">
          {title}
        </Text>
        <Text size="xs" c="dark.2">
          (Slower than {roundedP95}ms)
        </Text>
      </Group>
      {isLoading && !data ? (
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
        source && (
          <>
            <DBSqlRowTable
              sourceId={source.id}
              config={{
                ...source,
                where: '',
                whereLanguage: 'sql',
                select: [
                  {
                    valueExpression: source.timestampValueExpression,
                    alias: 'Timestamp',
                  },
                  {
                    valueExpression: expressions.severityText,
                    alias: 'Severity',
                  },
                  {
                    valueExpression: expressions.spanName,
                    alias: 'Span Name',
                  },
                  {
                    valueExpression: expressions.durationInMillis,
                    alias: 'Duration (ms)',
                  },
                ],
                orderBy: [
                  {
                    valueExpression: expressions.durationInMillis,
                    ordering: 'DESC',
                  },
                ],
                limit: { limit: 200 },
                dateRange,
                filters: [
                  ...extraFilters,
                  {
                    type: 'sql',
                    condition: `${expressions.durationInMillis} > ${roundedP95}`,
                  },
                ],
              }}
              onRowExpandClick={handleRowExpandClick}
              highlightedLineId={rowId ?? undefined}
              isLive={false}
              queryKeyPrefix="service-dashboard-slowest-transactions"
              onScroll={() => {}}
            />
            {rowId && rowSidePanelSource && (
              <DBRowSidePanel
                source={rowSidePanelSource}
                rowId={rowId}
                onClose={handleSidePanelClose}
              />
            )}
          </>
        )
      )}
    </ChartBox>
  );
}
