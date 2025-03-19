import { memo, useMemo, useState } from 'react';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Flex, Group, Pagination, Text } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { truncateMiddle } from '@/utils';

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
              <Text size="xs" mb="xs" c="gray.4">
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
    <div style={{ width: 340, height: 120 }}>
      <Text size="xs" c="gray.4" ta="center" title={name}>
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
            fill="#F81358"
            isAnimationActive={false}
          />
          <Bar
            dataKey="inlierCount"
            name="Inliers"
            fill="#09D99C"
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DBDeltaChart({
  config,
  outlierSqlCondition,
}: {
  config: ChartConfigWithOptDateRange;
  outlierSqlCondition: string;
}) {
  const { data: outlierData } = useQueriedChartConfig({
    ...config,
    with: [
      {
        name: 'PartIds',
        chartConfig: {
          ...config,
          select: 'tuple(_part, _part_offset)',
          filters: [
            ...(config.filters ?? []),
            {
              type: 'sql',
              condition: `${outlierSqlCondition}`,
            },
          ],
          orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
          limit: { limit: 1000 },
        },
      },
    ],
    select: '*',
    filters: [
      ...(config.filters ?? []),
      {
        type: 'sql',
        condition: `${outlierSqlCondition}`,
      },
      {
        type: 'sql',
        condition: `indexHint((_part, _part_offset) IN PartIds)`,
      },
    ],
    orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
    limit: { limit: 1000 },
  });

  const { data: inlierData } = useQueriedChartConfig({
    ...config,
    with: [
      {
        name: 'PartIds',
        chartConfig: {
          ...config,
          select: '_part, _part_offset',
          filters: [
            ...(config.filters ?? []),
            {
              type: 'sql',
              condition: `NOT (${outlierSqlCondition})`,
            },
          ],
          orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
          limit: { limit: 1000 },
        },
      },
    ],
    select: '*',
    filters: [
      ...(config.filters ?? []),
      {
        type: 'sql',
        condition: `NOT (${outlierSqlCondition})`,
      },
      {
        type: 'sql',
        condition: `indexHint((_part, _part_offset) IN PartIds)`,
      },
    ],
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

      const sortedProperties = Array.from(outlierValueOccurences.keys())
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

  const PAGE_SIZE = 12;

  return (
    <Box>
      <Flex justify="flex-end" mx="md" mb="md">
        <Pagination
          size="xs"
          value={activePage}
          onChange={setPage}
          total={Math.ceil(sortedProperties.length / PAGE_SIZE)}
        />
      </Flex>
      <Group>
        {Array.from(sortedProperties)
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
      </Group>
    </Box>
  );
}
