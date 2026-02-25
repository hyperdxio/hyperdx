import { memo, useEffect, useMemo, useState } from 'react';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import {
  getChartColorError,
  getChartColorSuccess,
  truncateMiddle,
} from '@/utils';

import { SQLPreview } from './ChartSQLPreview';

import styles from '../../styles/HDXLineChart.module.scss';

/*
 * Response Data is like... 
{
  Timestamp: "",
  Map: {
    "property": value,
  }
}

- Flatten
- Count Property Occurences
- Pick most common properties
- Count values for most common properties

- Merge both sets of properties? one property?
 */

// TODO: doesn't work for empty objects?
// https://stackoverflow.com/a/19101235
function flattenData(data: Record<string, any>) {
  const result: Record<string, any> = {};
  function recurse(cur: Record<string, any>, prop: string) {
    if (Object(cur) !== cur) {
      result[prop] = cur;
    } else if (Array.isArray(cur)) {
      let l;
      for (let i = 0, l = cur.length; i < l; i++)
        recurse(cur[i], prop + '[' + i + ']');
      if (l == 0) result[prop] = [];
    } else {
      let isEmpty = true;
      for (const p in cur) {
        isEmpty = false;
        recurse(cur[p], prop ? prop + '.' + p : p);
      }
      if (isEmpty && prop) result[prop] = {};
    }
  }
  recurse(data, '');
  return result;
}

function getPropertyStatistics(data: Record<string, any>[]) {
  const flattened = data.map(flattenData);
  const propertyOccurences = new Map<string, number>();

  const MIN_PROPERTY_OCCURENCES = 5;
  const commonProperties = new Set<string>();

  flattened.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      const count = propertyOccurences.get(key) || 0;
      propertyOccurences.set(key, count + 1);

      if (count + 1 >= MIN_PROPERTY_OCCURENCES) {
        commonProperties.add(key);
      }
    });
  });

  // property -> (value -> count)
  const valueOccurences = new Map<string, Map<string, number>>();
  flattened.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      if (commonProperties.has(key)) {
        let valuesMap = valueOccurences.get(key);
        if (!valuesMap) {
          valuesMap = new Map<string, number>();
          valueOccurences.set(key, valuesMap);
        }

        const valueCount = valuesMap.get(value) || 0;
        valuesMap.set(value, valueCount + 1);
      }
    });
  });

  const percentageOccurences = new Map<string, Map<string, number>>();
  valueOccurences.forEach((valuesMap, property) => {
    const percentageMap = new Map<string, number>();
    valuesMap.forEach((valueCount, value) => {
      percentageMap.set(
        value,
        (valueCount / (propertyOccurences.get(property) ?? 0)) * 100,
      );
    });
    percentageOccurences.set(property, percentageMap);
  });

  return {
    // valueOccurences,
    percentageOccurences,
    // commonProperties,
    // propertyOccurences,
  };
}

function mergeValueStatisticsMaps(
  outlierValues: Map<string, number>, // value -> count
  inlierValues: Map<string, number>,
) {
  const mergedArray: {
    name: string;
    outlierCount: number;
    inlierCount: number;
  }[] = [];
  // Collect all value names for this property
  // we sort them so timestamps are ordered
  const allValues = Array.from(
    new Set([...outlierValues.keys(), ...inlierValues.keys()]),
  ).sort();

  allValues.forEach(value => {
    const count1 = outlierValues.get(value) || 0;
    const count2 = inlierValues.get(value) || 0;
    mergedArray.push({
      name: value,
      outlierCount: count1,
      inlierCount: count2,
    });
  });

  return mergedArray;
}

const HDXBarChartTooltip = withErrorBoundary(
  memo((props: any) => {
    const { active, payload, label, title } = props;
    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <div className={styles.chartTooltipContent}>
            {title && (
              <Text size="xs" mb="xs">
                {title}
              </Text>
            )}
            <Text size="xs" mb="xs">
              {label.length === 0 ? <i>Empty String</i> : label}
            </Text>
            {payload
              .sort((a: any, b: any) => b.value - a.value)
              .map((p: any) => (
                <div key={p.dataKey}>
                  {p.name}: {p.value.toFixed(2)}%
                </div>
              ))}
          </div>
        </div>
      );
    }
    return null;
  }),
  {
    onError: console.error,
    fallback: (
      <div className="text-danger px-2 py-1 m-2 fs-8 font-monospace bg-danger-transparent">
        An error occurred while rendering the tooltip.
      </div>
    ),
  },
);

function PropertyComparisonChart({
  name,
  outlierValueOccurences,
  inlierValueOccurences,
}: {
  name: string;
  outlierValueOccurences: Map<string, number>;
  inlierValueOccurences: Map<string, number>;
}) {
  const mergedValueStatistics = mergeValueStatisticsMaps(
    outlierValueOccurences,
    inlierValueOccurences,
  );

  return (
    <div style={{ width: '100%', height: 120 }}>
      <Text size="xs" ta="center" title={name}>
        {truncateMiddle(name, 32)}
      </Text>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          barGap={2}
          width={500}
          height={300}
          data={mergedValueStatistics}
          margin={{
            top: 0,
            right: 0,
            left: 0,
            bottom: 0,
          }}
        >
          {/* <CartesianGrid strokeDasharray="3 3" /> */}
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip
            wrapperStyle={{
              zIndex: 1000,
            }}
            content={<HDXBarChartTooltip title={name} />}
            allowEscapeViewBox={{ y: true }}
          />
          <Bar
            dataKey="outlierCount"
            name="Outliers"
            fill={getChartColorError()}
            isAnimationActive={false}
          />
          <Bar
            dataKey="inlierCount"
            name="Inliers"
            fill={getChartColorSuccess()}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Layout constants for dynamic grid calculation.
// CHART_WIDTH is the minimum chart width used to determine how many columns fit; actual rendered
// width expands to fill the container (charts use width: '100%' inside a CSS grid).
// CHART_HEIGHT must match PropertyComparisonChart's outer div height.
// CHART_GAP is used both in the column/row formula and as the CSS grid gap.
const CHART_WIDTH = 340; // minimum column width threshold (px)
const CHART_HEIGHT = 120; // must match PropertyComparisonChart outer div height (px)
const CHART_GAP = 16; // px; used in grid gap and layout math
// Space reserved for the pagination row: Pagination control (~32px) + top padding (16px).
// Always reserved (even when pagination is hidden via visibility:hidden) so rows count is stable.
const PAGINATION_HEIGHT = 48;

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
