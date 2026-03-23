import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  BuilderChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Code,
  Container,
  Divider,
  Flex,
  Pagination,
  Text,
  Tooltip,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconX } from '@tabler/icons-react';

import { isAggregateFunction } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';
import { getChartColorError, getChartColorSuccess } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';
import type { AddFilterFn } from './deltaChartUtils';
import {
  ALL_SPANS_COLOR,
  computeComparisonScore,
  flattenedKeyToFilterKey,
  getPropertyStatistics,
  getStableSampleExpression,
  isDenylisted,
  isHighCardinality,
  SAMPLE_SIZE,
  semanticBoost,
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
  xMin: rawXMin,
  xMax: rawXMax,
  yMin: rawYMin,
  yMax: rawYMax,
  onAddFilter,
  onClearSelection,
  spanIdExpression,
  legendPrefix,
}: {
  config: BuilderChartConfigWithDateRange;
  valueExpr: string;
  xMin?: number | null;
  xMax?: number | null;
  yMin?: number | null;
  yMax?: number | null;
  onAddFilter?: AddFilterFn;
  onClearSelection?: () => void;
  spanIdExpression?: string;
  legendPrefix?: React.ReactNode;
}) {
  // Derive whether a heatmap selection exists from nullable props
  const hasSelection =
    rawXMin != null && rawXMax != null && rawYMin != null && rawYMax != null;
  // Safe numeric defaults so query builders always get valid values
  // (outlier/inlier queries are gated by enabled:hasSelection)
  const xMin = rawXMin ?? 0;
  const xMax = rawXMax ?? 0;
  const yMin = rawYMin ?? 0;
  const yMax = rawYMax ?? 0;

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

  const {
    data: outlierData,
    error: outlierError,
    isLoading: isOutlierLoading,
  } = useQueriedChartConfig(
    {
      ...config,
      with: buildWithClauses(true),
      select: '*',
      filters: buildFilters(true),
      orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
      limit: { limit: SAMPLE_SIZE },
    },
    { enabled: hasSelection },
  );

  const { data: inlierData, isLoading: isInlierLoading } =
    useQueriedChartConfig(
      {
        ...config,
        with: buildWithClauses(false),
        select: '*',
        filters: buildFilters(false),
        orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
        limit: { limit: SAMPLE_SIZE },
      },
      { enabled: hasSelection },
    );

  // When no selection exists, fetch all spans without any range filter
  const {
    data: allSpansData,
    error: allSpansError,
    isLoading: isAllSpansLoading,
  } = useQueriedChartConfig(
    {
      ...config,
      select: '*',
      orderBy: [{ ordering: 'DESC', valueExpression: stableSampleExpr }],
      limit: { limit: SAMPLE_SIZE },
    },
    { enabled: !hasSelection },
  );

  const isLoading = hasSelection
    ? isOutlierLoading || isInlierLoading
    : isAllSpansLoading;

  const error = outlierError ?? allSpansError;

  // Column metadata for field classification (from ClickHouse response)
  const columnMeta = useMemo<{ name: string; type: string }[]>(
    () => outlierData?.meta ?? inlierData?.meta ?? allSpansData?.meta ?? [],
    [outlierData?.meta, inlierData?.meta, allSpansData?.meta],
  );

  // Wrap onAddFilter to convert flattened dot-notation keys into ClickHouse bracket notation
  const handleAddFilter = useCallback<NonNullable<AddFilterFn>>(
    (property, value, action) => {
      if (!onAddFilter) return;
      onAddFilter(flattenedKeyToFilterKey(property, columnMeta), value, action);
    },
    [onAddFilter, columnMeta],
  );

  const {
    visibleProperties,
    hiddenProperties,
    outlierValueOccurences,
    inlierValueOccurences,
  } = useMemo(() => {
    // When no selection: use allSpans as "outlier" data and empty for inliers.
    // The sort will rank by frequency (delta = count - 0 = count).
    const actualOutlierData = hasSelection
      ? (outlierData?.data ?? [])
      : (allSpansData?.data ?? []);
    const actualInlierData = hasSelection ? (inlierData?.data ?? []) : [];

    const {
      percentageOccurences: outlierValueOccurences,
      propertyOccurences: outlierPropertyOccurences,
      valueOccurences: outlierRawValueOccurences,
    } = getPropertyStatistics(actualOutlierData);

    const {
      percentageOccurences: inlierValueOccurences,
      propertyOccurences: inlierPropertyOccurences,
      valueOccurences: inlierRawValueOccurences,
    } = getPropertyStatistics(actualInlierData);

    // Get all the unique keys from the outliers
    let uniqueKeys = new Set([...outlierValueOccurences.keys()]);
    // If there's no outliers, use inliers as the unique keys
    if (uniqueKeys.size === 0) {
      uniqueKeys = new Set([...inlierValueOccurences.keys()]);
    }
    // Sort by proportional comparison score (normalizes group sizes).
    // TODO: When #1824 (always-on distribution) merges, use computeEntropyScore
    // for distribution mode (no selection) and computeComparisonScore only when
    // a selection is active (hasSelection flag from #1824).
    const sortedProperties = Array.from(uniqueKeys)
      .map(key => {
        const inlierCount =
          inlierValueOccurences.get(key) ?? new Map<string, number>();
        const outlierCount =
          outlierValueOccurences.get(key) ?? new Map<string, number>();

        // Use proportional comparison scoring which normalizes group sizes.
        // Semantic boost acts as a tiebreaker for well-known OTel attributes
        // (only applied when the field has actual variance).
        const baseScore = computeComparisonScore(outlierCount, inlierCount);
        const boost = baseScore > 0 ? semanticBoost(key) * 0.1 : 0;
        const sortScore = baseScore + boost;

        return [key, sortScore] as const;
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
  }, [
    outlierData?.data,
    inlierData?.data,
    allSpansData?.data,
    hasSelection,
    columnMeta,
  ]);

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
  // The "Lower-priority fields" divider (~30px) may appear between visible
  // and hidden sections on the same page.  Reserve space for it so the last
  // chart row + pagination aren't pushed out of the overflow:hidden container.
  const hasDivider =
    visibleProperties.length > 0 && hiddenProperties.length > 0;
  const dividerHeight = hasDivider ? 30 : 0;
  const rows = Math.max(
    1,
    Math.floor(
      (containerHeight - PAGINATION_HEIGHT - dividerHeight + CHART_GAP) /
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
      {/* Legend */}
      <Flex gap="md" align="center" mt={2} mb="xs" wrap="wrap">
        {legendPrefix}
        {legendPrefix && (
          <Box
            h={12}
            style={{
              borderLeft: '1px solid var(--mantine-color-default-border)',
            }}
          />
        )}
        {hasSelection ? (
          <>
            <Flex align="center" gap={4}>
              <Box
                w={10}
                h={10}
                style={{
                  background: getChartColorError(),
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" c="dimmed">
                Selection
              </Text>
            </Flex>
            <Flex align="center" gap={4}>
              <Box
                w={10}
                h={10}
                style={{
                  background: getChartColorSuccess(),
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" c="dimmed">
                Background
              </Text>
            </Flex>
            {onClearSelection && (
              <Tooltip label="Clear selection">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="gray"
                  onClick={onClearSelection}
                  aria-label="Clear selection"
                >
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            <Flex align="center" gap={4}>
              <Box
                w={10}
                h={10}
                style={{
                  background: ALL_SPANS_COLOR,
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" c="dimmed">
                All spans
              </Text>
            </Flex>
            <Text size="xs" c="dimmed" fs="italic">
              {isLoading
                ? 'Loading\u2026'
                : 'Select an area on the chart above to enable comparisons'}
            </Text>
          </>
        )}
      </Flex>
      {/* Loading state */}
      {isLoading && visibleOnPage.length === 0 && hiddenOnPage.length === 0 && (
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Text size="sm" c="dimmed">
            Loading attribute distributions\u2026
          </Text>
        </Flex>
      )}
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
              hasSelection={hasSelection}
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
      {/* Lower-priority fields - separate grid so rows align independently */}
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
              hasSelection={hasSelection}
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
