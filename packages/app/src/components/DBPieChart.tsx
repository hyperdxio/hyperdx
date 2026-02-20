import { useMemo } from 'react';
import randomUUID from 'crypto-randomuuid';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Flex, Text } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToPieChartConfig,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { COLORS } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { SQLPreview } from './ChartSQLPreview';

export const DBPieChart = ({
  config,
  title,
  enabled = true,
  queryKeyPrefix,
  showMVOptimizationIndicator = true,
  toolbarPrefix,
  toolbarSuffix,
}: {
  config: ChartConfigWithOptTimestamp;
  title?: React.ReactNode;
  enabled?: boolean;
  queryKeyPrefix?: string;
  showMVOptimizationIndicator?: boolean;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
}) => {
  const { data: source } = useSource({ id: config.source });

  const queriedConfig = useMemo(() => {
    return convertToPieChartConfig(config);
  }, [config]);

  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(queriedConfig);

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  // Returns an array of aliases, so we can check if something is using an alias
  const aliasMap = useMemo(() => {
    // If the config.select is a string, we can't infer this.
    // One day, we could potentially run this through chSqlToAliasMap but AST parsing
    //  doesn't work for most DBTableChart queries.
    if (typeof config.select === 'string') {
      return [];
    }
    return config.select.reduce((acc, select) => {
      if (select.alias) {
        acc.push(select.alias);
      }
      return acc;
    }, [] as string[]);
  }, [config.select]);

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-table-chart-mv-indicator"
          config={queriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const dateRangeIndicator = buildMVDateRangeIndicator({
      mvOptimizationData,
      originalDateRange: queriedConfig.dateRange,
    });

    if (dateRangeIndicator) {
      allToolbarItems.push(dateRangeIndicator);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    toolbarPrefix,
    toolbarSuffix,
    source,
    showMVOptimizationIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);

  // Extract group column names from groupBy config
  const groupByKeys = useMemo(() => {
    if (!queriedConfig.groupBy) return [];

    if (typeof queriedConfig.groupBy === 'string') {
      return queriedConfig.groupBy.split(',').map(v => v.trim());
    }

    return queriedConfig.groupBy.map(g =>
      typeof g === 'string' ? g : g.valueExpression,
    );
  }, [queriedConfig.groupBy]);

  const pieChartData = useMemo(() => {
    if (!data || data.data.length === 0) return [];

    if (groupByKeys.length > 0 && data.data.length > 0) {
      const groupColumnSet = new Set(groupByKeys);

      return data.data.map((row, index) => {
        const label =
          groupByKeys.length === 1
            ? String(row[groupByKeys[0]])
            : groupByKeys.map(key => row[key]).join(' - ');

        let totalValue = 0;
        for (const key in row) {
          if (!groupColumnSet.has(key)) {
            const numValue = parseFloat(row[key]);
            if (!isNaN(numValue)) {
              totalValue += numValue;
            }
          }
        }

        return {
          label,
          value: totalValue,
          color:
            index >= COLORS.length
              ? // Source - https://stackoverflow.com/a/5092872
                '#000000'.replace(/0/g, () => {
                  return (~~(Math.random() * 16)).toString(16);
                })
              : COLORS[index],
        };
      });
    }

    if (data.data.length === 1) {
      const queryData = data.data[0];

      return Object.keys(queryData).map((key, index) => ({
        // If it's an alias, wrap in quotes to support a variety of formats (ex "Time (ms)", "Req/s", etc)
        label: aliasMap.includes(key) ? `${key}` : key,
        value: parseFloat(queryData[key]),
        color:
          index >= COLORS.length
            ? // Source - https://stackoverflow.com/a/5092872
              '#000000'.replace(/0/g, () => {
                return (~~(Math.random() * 16)).toString(16);
              })
            : COLORS[index],
      }));
    }

    return [];
  }, [data, aliasMap, groupByKeys]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <div className="h-100 w-100 align-items-center justify-content-center text-muted overflow-scroll">
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
        <Flex
          data-testid="pie-chart-container"
          align="center"
          justify="center"
          h="100%"
          style={{ flexGrow: 1 }}
        >
          <ResponsiveContainer
            height="100%"
            width="100%"
            className={isLoading ? 'effect-pulse' : ''}
          >
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={pieChartData}
                dataKey="value"
                fill="#8884d8"
                nameKey="label"
                legendType="none"
              >
                {pieChartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
