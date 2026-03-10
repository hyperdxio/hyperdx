import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  BuilderChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Code,
  Container,
  Divider,
  Flex,
  Pagination,
  Text,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';

import { isAggregateFunction } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';

import { SQLPreview } from './ChartSQLPreview';
import type { AddFilterFn } from './deltaChartUtils';
import {
  flattenedKeyToFilterKey,
  getPropertyStatistics,
  getStableSampleExpression,
  isDenylisted,
  isHighCardinality,
  mergeValueStatisticsMaps,
  SAMPLE_SIZE,
} from './deltaChartUtils';
import {
  CHART_GAP,
  CHART_HEIGHT,
  CHART_WIDTH,
  PAGINATION_HEIGHT,
  PropertyComparisonChart,
} from './PropertyComparisonChart';

// Re-export types so callers importing from DBDeltaChart don't need to change.
export type { AddFilterFn } from './deltaChartUtils';

export default function DBDeltaChart({
  config,
  valueExpr,
  xMin,
  xMax,
  yMin,
  yMax,
  onAddFilter,
  spanIdExpression,
}: {
  config: BuilderChartConfigWithDateRange;
  valueExpr: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  onAddFilter?: AddFilterFn;
  spanIdExpression?: string;
}) {
  // Determine if the value expression uses aggregate functions
  const isAggregate = isAggregateFunction(valueExpr);

  // Build deterministic ORDER BY expression from source's spanIdExpression
  const stableSampleExpr = getStableSampleExpression(spanIdExpression);

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
  ): NonNullable<BuilderChartConfigWithDateRange['with']> => {
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
          orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
          limit: { limit: SAMPLE_SIZE },
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
    orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
    limit: { limit: SAMPLE_SIZE },
  });

  const { data: inlierData } = useQueriedChartConfig({
    ...config,
    with: buildWithClauses(false),
    select: '*',
    filters: buildFilters(false),
    orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
    limit: { limit: SAMPLE_SIZE },
  });

  // Column metadata for field classification (from ClickHouse response)
  const columnMeta = useMemo<{ name: string; type: string }[]>(
    () => outlierData?.meta ?? inlierData?.meta ?? [],
    [outlierData?.meta, inlierData?.meta],
  );

  // Wrap onAddFilter to convert flattened dot-notation keys into ClickHouse bracket notation
  const handleAddFilter = useCallback<NonNullable<AddFilterFn>>(
    (property, value, action) => {
      if (!onAddFilter) return;
      onAddFilter(flattenedKeyToFilterKey(property, columnMeta), value, action);
    },
    [onAddFilter, columnMeta],
  );

  // TODO: Is loading state
  const {
    visibleProperties,
    hiddenProperties,
    outlierValueOccurences,
    inlierValueOccurences,
  } = useMemo(() => {
    const {
      percentageOccurences: outlierValueOccurences,
      propertyOccurences: outlierPropertyOccurences,
      valueOccurences: outlierRawValueOccurences,
    } = getPropertyStatistics(outlierData?.data ?? []);

    const {
      percentageOccurences: inlierValueOccurences,
      propertyOccurences: inlierPropertyOccurences,
      valueOccurences: inlierRawValueOccurences,
    } = getPropertyStatistics(inlierData?.data ?? []);

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

        const mergedArray = mergeValueStatisticsMaps(outlierCount, inlierCount);
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

    // Split into visible (primary) and hidden (denylisted + high cardinality)
    const visibleProperties: string[] = [];
    const hiddenProperties: string[] = [];
    sortedProperties.forEach(key => {
      if (isDenylisted(key, columnMeta)) {
        hiddenProperties.push(key);
      } else if (
        isHighCardinality(
          key,
          outlierRawValueOccurences,
          inlierRawValueOccurences,
          outlierPropertyOccurences,
          inlierPropertyOccurences,
        )
      ) {
        hiddenProperties.push(key);
      } else {
        visibleProperties.push(key);
      }
    });

    return {
      visibleProperties,
      hiddenProperties,
      outlierValueOccurences,
      inlierValueOccurences,
    };
  }, [outlierData?.data, inlierData?.data, columnMeta]);

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
  useEffect(() => {
    setPage(1);
  }, [columns, rows, xMin, xMax, yMin, yMax]);

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

  // Row-based pagination: visible and hidden sections are separate grids,
  // so an incomplete last row of visible fields does not get "filled" with hidden items.
  const visibleRows = Math.ceil(visibleProperties.length / columns);
  const hiddenRows = Math.ceil(hiddenProperties.length / columns);
  const totalRows = visibleRows + hiddenRows;
  const totalPages = Math.ceil(totalRows / rows);

  const pageRowStart = (activePage - 1) * rows;
  const pageRowEnd = activePage * rows;

  // Rows occupied by the visible section on this page
  const visRowStart = Math.min(pageRowStart, visibleRows);
  const visRowEnd = Math.min(pageRowEnd, visibleRows);
  const visibleOnPage = visibleProperties.slice(
    visRowStart * columns,
    Math.min(visRowEnd * columns, visibleProperties.length),
  );

  // Rows occupied by the hidden section on this page
  const hidRowStart = Math.max(0, pageRowStart - visibleRows);
  const hidRowEnd = Math.min(hiddenRows, Math.max(0, pageRowEnd - visibleRows));
  const hiddenOnPage = hiddenProperties.slice(
    hidRowStart * columns,
    Math.min(hidRowEnd * columns, hiddenProperties.length),
  );

  // Show a divider when both sections appear on the same page
  const showDivider = visibleOnPage.length > 0 && hiddenOnPage.length > 0;
  // Show a header when ONLY hidden fields appear on this page (no divider above)
  const showHiddenHeader =
    hiddenOnPage.length > 0 && visibleOnPage.length === 0;

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
      {/* Primary fields */}
      {visibleOnPage.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: CHART_GAP,
          }}
        >
          {visibleOnPage.map(property => (
            <PropertyComparisonChart
              name={property}
              outlierValueOccurences={
                outlierValueOccurences.get(property) ?? new Map()
              }
              inlierValueOccurences={
                inlierValueOccurences.get(property) ?? new Map()
              }
              onAddFilter={onAddFilter ? handleAddFilter : undefined}
              key={property}
            />
          ))}
        </div>
      )}
      {/* Divider between primary and lower-priority fields */}
      {(showDivider || showHiddenHeader) && (
        <Divider
          mt="lg"
          mb="xs"
          label={
            <Text size="xs" c="dimmed">
              Lower-priority fields ({hiddenProperties.length})
            </Text>
          }
          labelPosition="left"
        />
      )}
      {/* Lower-priority fields — separate grid so rows align independently */}
      {hiddenOnPage.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: CHART_GAP,
          }}
        >
          {hiddenOnPage.map(key => (
            <PropertyComparisonChart
              name={key}
              outlierValueOccurences={
                outlierValueOccurences.get(key) ?? new Map()
              }
              inlierValueOccurences={
                inlierValueOccurences.get(key) ?? new Map()
              }
              onAddFilter={onAddFilter ? handleAddFilter : undefined}
              key={key}
            />
          ))}
        </div>
      )}
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
