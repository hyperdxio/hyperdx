import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Code,
  Divider,
  Flex,
  Pagination,
  Text,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';

import { isAggregateFunction } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';
import { getChartColorError, getChartColorSuccess } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';
import {
  CHART_GAP,
  CHART_HEIGHT,
  CHART_WIDTH,
  PAGINATION_HEIGHT,
  PropertyComparisonChart,
} from './PropertyComparisonChart';
import type { AddFilterFn, HighlightPoint } from './deltaChartUtils';
import {
  ALL_SPANS_COLOR,
  DISTRIBUTION_SCORING,
  SAMPLE_SIZE,
  STABLE_SAMPLE_EXPR,
  computeComparisonScore,
  computeDistributionScore,
  computeEffectiveSampleSize,
  computeEntropyScore,
  computeYValue,
  flattenData,
  flattenedKeyToSqlExpression,
  getPropertyStatistics,
  isDenylisted,
  isHighCardinality,
  mergeValueStatisticsMaps,
  semanticBoost,
  stripTypeWrappers,
} from './deltaChartUtils';

// Re-export types so callers importing from DBDeltaChart don't need to change.
export type { AddFilterFn, HighlightPoint } from './deltaChartUtils';

export default function DBDeltaChart({
  config,
  valueExpr,
  xMin: rawXMin,
  xMax: rawXMax,
  yMin: rawYMin,
  yMax: rawYMax,
  onAddFilter,
  onHighlightPoints,
}: {
  config: ChartConfigWithDateRange;
  valueExpr: string;
  xMin?: number | null;
  xMax?: number | null;
  yMin?: number | null;
  yMax?: number | null;
  onAddFilter?: AddFilterFn;
  onHighlightPoints?: (points: HighlightPoint[] | null) => void;
}) {
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
          orderBy: [{ ordering: 'DESC', valueExpression: STABLE_SAMPLE_EXPR }],
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

  // Lightweight count query to support adaptive sample sizing.
  // ClickHouse resolves count() from MergeTree metadata, so this is near-instant.
  // useQueriedChartConfig internally gates on source/MV metadata readiness.
  const { data: countData } = useQueriedChartConfig({
    ...config,
    select: 'count() as total',
  });
  const totalCount = Number(
    (countData?.data as Record<string, unknown>[])?.[0]?.total ?? 0,
  );
  const effectiveSampleSize = computeEffectiveSampleSize(totalCount);

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
      orderBy: [{ ordering: 'DESC', valueExpression: STABLE_SAMPLE_EXPR }],
      limit: { limit: effectiveSampleSize },
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
        orderBy: [{ ordering: 'DESC', valueExpression: STABLE_SAMPLE_EXPR }],
        limit: { limit: effectiveSampleSize },
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
      orderBy: [{ ordering: 'DESC', valueExpression: STABLE_SAMPLE_EXPR }],
      limit: { limit: effectiveSampleSize },
    },
    { enabled: !hasSelection },
  );

  const isLoading = hasSelection
    ? isOutlierLoading || isInlierLoading
    : isAllSpansLoading;

  const error = outlierError ?? allSpansError;

  // Compute column metadata, property statistics, sorted/visible/hidden property lists.
  // columnMeta is merged here (instead of a separate useMemo) so the denylist and
  // cardinality checks can reference it during the same memoization pass.
  const {
    outlierValueOccurences,
    inlierValueOccurences,
    columnMeta,
    visibleProperties,
    hiddenProperties,
    highlightIndex,
    sampleRowCount,
  } = useMemo(() => {
    const columnMeta = (
      outlierData?.meta ??
      inlierData?.meta ??
      allSpansData?.meta ??
      []
    ) as {
      name: string;
      type: string;
    }[];

    // When no selection: use allSpans as "outlier" data and empty for inliers.
    // The sort will rank by frequency (delta = count - 0 = count).
    const actualOutlierData = hasSelection
      ? (outlierData?.data ?? [])
      : (allSpansData?.data ?? []);
    const actualInlierData = hasSelection ? (inlierData?.data ?? []) : [];

    const {
      percentageOccurences: outlierValueOccurences,
      propertyOccurences: outlierPropertyOccurences,
    } = getPropertyStatistics(actualOutlierData);

    const {
      percentageOccurences: inlierValueOccurences,
      propertyOccurences: inlierPropertyOccurences,
    } = getPropertyStatistics(actualInlierData);

    // Get all the unique keys from the outliers
    let uniqueKeys = new Set([...outlierValueOccurences.keys()]);
    // If there's no outliers, use inliers as the unique keys
    if (uniqueKeys.size === 0) {
      uniqueKeys = new Set([...inlierValueOccurences.keys()]);
    }
    // Sort properties by how useful they are for filtering/analysis.
    // Comparison mode: sort by max difference between selection and background.
    // Distribution mode (no selection): sort by deviation from uniform distribution —
    //   score = max(pct) - mean(pcts)
    //   This scores 0 for single-value fields (all-same) and for perfectly uniform
    //   multi-value fields, and scores high for skewed distributions.
    const sortedProperties = Array.from(uniqueKeys)
      .map(key => {
        const inlierCount =
          inlierValueOccurences.get(key) ?? new Map<string, number>();
        const outlierCount =
          outlierValueOccurences.get(key) ?? new Map<string, number>();

        let sortScore: number;
        if (hasSelection) {
          // Comparison mode: sort by proportional distribution difference.
          // Normalizes each group's percentages before comparing, so fields
          // with identical proportions (e.g., 100% "message" in both) score 0
          // regardless of coverage rate differences between groups.
          sortScore = computeComparisonScore(outlierCount, inlierCount);
        } else {
          // Distribution mode: sort by how useful the field is for filtering.
          // Fields with actual variance (multiple values, unequal distribution)
          // always rank above single-value or perfectly uniform fields.
          const baseScore =
            DISTRIBUTION_SCORING === 'entropy'
              ? computeEntropyScore(outlierCount)
              : computeDistributionScore(outlierCount);
          // Semantic boost only applies when the field has actual variance
          // (baseScore > 0). Scaled to 0.1 so it acts as a tiebreaker —
          // never overrides a genuinely more interesting distribution.
          const boost =
            baseScore > 0 ? semanticBoost(key) * 0.1 : 0;
          sortScore = baseScore + boost;
        }

        return [key, sortScore] as const;
      })
      .sort((a, b) => b[1] - a[1])
      .map(a => a[0]);

    // Split properties into visible (shown in charts) and hidden (denylist or high cardinality)
    const visibleProperties: string[] = [];
    const hiddenProperties: string[] = [];

    sortedProperties.forEach(key => {
      if (isDenylisted(key, columnMeta)) {
        hiddenProperties.push(key);
      } else if (
        isHighCardinality(
          key,
          outlierValueOccurences,
          inlierValueOccurences,
          outlierPropertyOccurences,
          inlierPropertyOccurences,
        )
      ) {
        hiddenProperties.push(key);
      } else {
        visibleProperties.push(key);
      }
    });

    // Build a pre-indexed lookup for hover-based timestamp highlighting.
    // Structure: property → value → HighlightPoint[]
    // This replaces the O(n) scan per hover with an O(1) Map lookup.
    const flattenedRawData = [
      ...actualOutlierData.map(flattenData),
      ...actualInlierData.map(flattenData),
    ];

    // Find the first non-array DateTime64 column (typically 'Timestamp')
    const tsColName = columnMeta.find(
      c =>
        (stripTypeWrappers(c.type).startsWith('DateTime64(') ||
          c.type === 'DateTime64') &&
        !stripTypeWrappers(c.type).startsWith('Array('),
    )?.name;

    const highlightIndex = new Map<string, Map<string, HighlightPoint[]>>();
    if (tsColName) {
      for (const flat of flattenedRawData) {
        const ts = flat[tsColName];
        if (ts == null) continue;
        const tsMs = new Date(ts as string).getTime();
        if (isNaN(tsMs)) continue;
        const yValue = computeYValue(valueExpr, flat);
        const point: HighlightPoint = { tsMs, yValue };

        for (const [key, val] of Object.entries(flat)) {
          if (key === tsColName) continue;
          const strVal = String(val);
          let valueMap = highlightIndex.get(key);
          if (!valueMap) {
            valueMap = new Map<string, HighlightPoint[]>();
            highlightIndex.set(key, valueMap);
          }
          let points = valueMap.get(strVal);
          if (!points) {
            points = [];
            valueMap.set(strVal, points);
          }
          points.push(point);
        }
      }
    }

    // Row counts for the sample-size annotation in the legend
    const sampleRowCount = actualOutlierData.length + actualInlierData.length;

    return {
      outlierValueOccurences,
      inlierValueOccurences,
      columnMeta,
      visibleProperties,
      hiddenProperties,
      highlightIndex,
      sampleRowCount,
    };
  }, [outlierData, inlierData, allSpansData, hasSelection, valueExpr]);

  // Wrap onAddFilter to convert flattened dot-notation keys (from flattenData)
  // into valid ClickHouse SQL expressions before passing to the filter handler.
  const handleAddFilter = useCallback<NonNullable<AddFilterFn>>(
    (property, value, action) => {
      if (!onAddFilter) return;
      onAddFilter(
        flattenedKeyToSqlExpression(property, columnMeta),
        value,
        action,
      );
    },
    [onAddFilter, columnMeta],
  );

  // Track hovered attribute value for correlation highlighting on the heatmap
  const [hoveredAttributeValue, setHoveredAttributeValue] = useState<{
    property: string;
    value: string;
  } | null>(null);

  const handleHoverValue = useCallback(
    (property: string, value: string | null) => {
      setHoveredAttributeValue(value != null ? { property, value } : null);
    },
    [],
  );

  // O(1) lookup: retrieve pre-indexed {tsMs, yValue} pairs for the hovered attribute.
  const highlightPoints = useMemo((): HighlightPoint[] | null => {
    if (!hoveredAttributeValue) return null;
    const { property, value } = hoveredAttributeValue;
    const points = highlightIndex.get(property)?.get(value);
    return points?.length ? points : null;
  }, [hoveredAttributeValue, highlightIndex]);

  // Propagate highlight points to parent (e.g., DBSearchHeatmapChart)
  useEffect(() => {
    onHighlightPoints?.(highlightPoints);
  }, [highlightPoints, onHighlightPoints]);

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
      <Box style={{ overflow: 'auto' }}>
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
      </Box>
    );
  }

  // Paginate by ROWS, not by item count, because visible and hidden fields are
  // rendered in separate CSS grids. An incomplete last row of the visible
  // section must not be "filled" with hidden items — each section always starts
  // from column 1.
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
  const showHiddenHeader = hiddenOnPage.length > 0 && visibleOnPage.length === 0;

  return (
    <Box
      ref={containerRef}
      p="sm"
      style={{
        overflowX: 'hidden',
        overflowY: 'auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Legend */}
      <Flex gap="md" align="center" mb="xs" wrap="wrap">
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
            {!isLoading && sampleRowCount > 0 && (
              <Text size="xs" c="dimmed" fs="italic">
                (n={sampleRowCount.toLocaleString()}
                {totalCount > 0
                  ? ` of ${totalCount.toLocaleString()}`
                  : ''}{' '}
                sampled)
              </Text>
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
              {!isLoading && sampleRowCount > 0 && (
                <Text size="xs" c="dimmed" fs="italic">
                  (n={sampleRowCount.toLocaleString()} sampled)
                </Text>
              )}
            </Flex>
            <Text size="xs" c="dimmed" fs="italic">
              {isLoading
                ? 'Loading…'
                : 'Select an area on the chart above to enable comparisons'}
            </Text>
          </>
        )}
      </Flex>
      {/* Loading state */}
      {isLoading && visibleOnPage.length === 0 && hiddenOnPage.length === 0 && (
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Text size="sm" c="dimmed">
            Loading attribute distributions…
          </Text>
        </Flex>
      )}
      {/* Primary fields — own grid so empty trailing cells don't interact with divider */}
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
              hasSelection={hasSelection}
              onHoverValue={onHighlightPoints ? handleHoverValue : undefined}
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
              hasSelection={hasSelection}
              onHoverValue={onHighlightPoints ? handleHoverValue : undefined}
              key={key}
            />
          ))}
        </div>
      )}
      <Flex
        justify="flex-end"
        align="center"
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
