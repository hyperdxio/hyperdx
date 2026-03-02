import { useEffect, useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import { Box, Code, Container, Flex, Pagination, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';

import { isAggregateFunction } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';

import { SQLPreview } from './ChartSQLPreview';
import {
  getPropertyStatistics,
  mergeValueStatisticsMaps,
} from './deltaChartUtils';
import {
  CHART_GAP,
  CHART_HEIGHT,
  CHART_WIDTH,
  PAGINATION_HEIGHT,
  PropertyComparisonChart,
} from './PropertyComparisonChart';

export default function DBDeltaChart({
  config,
  valueExpr,
  xMin,
  xMax,
  yMin,
  yMax,
}: {
  config: ChartConfigWithDateRange;
  valueExpr: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}) {
  // Determine if the value expression uses aggregate functions
  const isAggregate = isAggregateFunction(valueExpr);

  // Get the timestamp expression from config
  const timestampExpr = getFirstTimestampValueExpression(
    config.timestampValueExpression,
  );

  // Helper to build the shared AggregatedTimestamps CTE (used by both outlier and inlier queries)
  const buildAggregatedTimestampsCTE = () =>
    isAggregate
      ? {
          name: 'AggregatedTimestamps',
          chartConfig: {
            ...config,
            from: config.from,
            select: timestampExpr,
            filters: [
              ...(config.filters ?? []),
              {
                type: 'sql',
                condition: `${timestampExpr} >= ${xMin}`,
              } satisfies Filter,
              {
                type: 'sql',
                condition: `${timestampExpr} <= ${xMax}`,
              } satisfies Filter,
              ...(config.where
                ? [
                    {
                      type: config.whereLanguage,
                      condition: config.where,
                    } as Filter,
                  ]
                : []),
            ],
            groupBy: timestampExpr,
            having: `(${valueExpr}) >= ${yMin} AND (${valueExpr}) <= ${yMax}`,
          },
        }
      : null;

  // Helper to build WITH clauses for a query (outlier or inlier)
  const buildWithClauses = (
    isOutlier: boolean,
  ): NonNullable<ChartConfigWithOptDateRange['with']> => {
    const aggregatedTimestampsCTE = buildAggregatedTimestampsCTE();

    // Build the SQL condition for filtering
    const buildSqlCondition = () => {
      const timestampExpression = `${timestampExpr} >= ${xMin} AND ${timestampExpr} <= ${xMax}`;
      let query = timestampExpression;
      if (!isAggregate) {
        // For non-aggregates, we filter directly on both timestamp and value
        query += ` AND (${valueExpr}) >= ${yMin} AND (${valueExpr}) <= ${yMax}`;
      }
      return isOutlier ? query : `NOT (${query})`;
    };

    const sqlCondition = buildSqlCondition();
    const aggregateTimestampCondition = isOutlier
      ? `${timestampExpr} IN (SELECT ${timestampExpr} FROM AggregatedTimestamps)`
      : `${timestampExpr} NOT IN (SELECT ${timestampExpr} FROM AggregatedTimestamps)`;

    return [
      ...(aggregatedTimestampsCTE ? [aggregatedTimestampsCTE] : []),
      {
        name: 'PartIds',
        chartConfig: {
          ...config,
          select: 'tuple(_part, _part_offset)',
          filters: [
            ...(config.filters ?? []),
            {
              type: 'sql',
              condition: sqlCondition,
            } satisfies Filter,
            ...(isAggregate
              ? [
                  {
                    type: 'sql',
                    condition: aggregateTimestampCondition,
                  } satisfies Filter,
                ]
              : []),
          ],
          orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
          limit: { limit: 1000 },
        },
      },
    ];
  };

  // Helper to build filters for the main query
  const buildFilters = (isOutlier: boolean) => {
    // Build the SQL condition for filtering
    const buildSqlCondition = () => {
      if (isAggregate) {
        // For aggregates, we filter by timestamp range
        return isOutlier
          ? `${timestampExpr} >= ${xMin} AND ${timestampExpr} <= ${xMax}`
          : `NOT (${timestampExpr} >= ${xMin} AND ${timestampExpr} <= ${xMax})`;
      } else {
        // For non-aggregates, we filter directly on both timestamp and value
        return isOutlier
          ? `(${valueExpr}) >= ${yMin} AND (${valueExpr}) <= ${yMax} AND ${timestampExpr} >= ${xMin} AND ${timestampExpr} <= ${xMax}`
          : `NOT ((${valueExpr}) >= ${yMin} AND (${valueExpr}) <= ${yMax} AND ${timestampExpr} >= ${xMin} AND ${timestampExpr} <= ${xMax})`;
      }
    };

    const sqlCondition = buildSqlCondition();
    const aggregateTimestampCondition = isOutlier
      ? `${timestampExpr} IN (SELECT ${timestampExpr} FROM AggregatedTimestamps)`
      : `${timestampExpr} NOT IN (SELECT ${timestampExpr} FROM AggregatedTimestamps)`;

    return [
      ...(config.filters ?? []),
      {
        type: 'sql',
        condition: sqlCondition,
      } as { type: 'sql'; condition: string },
      ...(isAggregate
        ? [
            {
              type: 'sql',
              condition: aggregateTimestampCondition,
            } as { type: 'sql'; condition: string },
          ]
        : []),
      {
        type: 'sql',
        condition: `indexHint((_part, _part_offset) IN PartIds)`,
      } as { type: 'sql'; condition: string },
    ];
  };

  const { data: outlierData, error } = useQueriedChartConfig({
    ...config,
    with: buildWithClauses(true),
    select: '*',
    filters: buildFilters(true),
    orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
    limit: { limit: 1000 },
  });

  const { data: inlierData } = useQueriedChartConfig({
    ...config,
    with: buildWithClauses(false),
    select: '*',
    filters: buildFilters(false),
    orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
    limit: { limit: 1000 },
  });

  // TODO: Is loading state
  const { sortedProperties, outlierValueOccurences, inlierValueOccurences } =
    useMemo(() => {
      const { percentageOccurences: outlierValueOccurences } =
        getPropertyStatistics(outlierData?.data ?? []);

      const { percentageOccurences: inlierValueOccurences } =
        getPropertyStatistics(inlierData?.data ?? []);

      // Get all the unique keys from the outliers
      let uniqueKeys = new Set([...outlierValueOccurences.keys()]);
      // If there's no outliers, use inliers as the unique keys
      if (uniqueKeys.size === 0) {
        uniqueKeys = new Set([...inlierValueOccurences.keys()]);
      }
      // Now process the keys to find the ones with the highest delta between outlier and inlier percentages
      const sortedProperties = Array.from(uniqueKeys)
        .map(key => {
          const inlierCount =
            inlierValueOccurences.get(key) ?? new Map<string, number>();
          const outlierCount =
            outlierValueOccurences.get(key) ?? new Map<string, number>();

          const mergedArray = mergeValueStatisticsMaps(
            outlierCount,
            inlierCount,
          );
          let maxValueDelta = 0;
          mergedArray.forEach(item => {
            const delta = Math.abs(item.outlierCount - item.inlierCount);
            if (delta > maxValueDelta) {
              maxValueDelta = delta;
            }
          });

          return [key, maxValueDelta] as const;
        })
        .sort((a, b) => b[1] - a[1])
        .map(a => a[0]);

      return {
        sortedProperties,
        outlierValueOccurences,
        inlierValueOccurences,
      };
    }, [outlierData?.data, inlierData?.data]);

  const [activePage, setPage] = useState(1);

  const {
    ref: containerRef,
    width: containerWidth,
    height: containerHeight,
  } = useElementSize();

  const columns = Math.max(
    1,
    Math.floor((containerWidth + CHART_GAP) / (CHART_WIDTH + CHART_GAP)),
  );
  const rows = Math.max(
    1,
    Math.floor(
      (containerHeight - PAGINATION_HEIGHT + CHART_GAP) /
        (CHART_HEIGHT + CHART_GAP),
    ),
  );
  const PAGE_SIZE = columns * rows;

  useEffect(() => {
    setPage(1);
  }, [PAGE_SIZE, xMin, xMax, yMin, yMax]);

  if (error) {
    return (
      <Container style={{ overflow: 'auto' }}>
        <Box mt="lg">
          <Text my="sm" size="sm">
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
        </Box>
        {error instanceof ClickHouseQueryError && (
          <Box mt="lg">
            <Text my="sm" size="sm">
              Original Query:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              <SQLPreview data={error.query} formatData />
            </Code>
          </Box>
        )}
      </Container>
    );
  }

  const totalPages = Math.ceil(sortedProperties.length / PAGE_SIZE);

  return (
    <Box
      ref={containerRef}
      p="sm"
      style={{
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: CHART_GAP,
        }}
      >
        {sortedProperties
          .slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
          .map(property => (
            <PropertyComparisonChart
              name={property}
              outlierValueOccurences={
                outlierValueOccurences.get(property) ?? new Map()
              }
              inlierValueOccurences={
                inlierValueOccurences.get(property) ?? new Map()
              }
              key={property}
            />
          ))}
      </div>
      <Flex
        justify="flex-end"
        style={{
          marginTop: 'auto',
          paddingTop: CHART_GAP,
          visibility: totalPages > 1 ? 'visible' : 'hidden',
        }}
      >
        <Pagination
          size="xs"
          value={activePage}
          onChange={setPage}
          total={totalPages}
        />
      </Flex>
    </Box>
  );
}
