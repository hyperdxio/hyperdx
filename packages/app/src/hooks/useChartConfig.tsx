import { ResponseJSON } from '@clickhouse/client-web';
import {
  ChSql,
  chSqlToAliasMap,
  ClickHouseQueryError,
  inferTimestampColumn,
  parameterizedQueryToSql,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { getMetadata } from '@/metadata';

export const isMetric = (config: ChartConfigWithOptDateRange) =>
  config.metricTables != null;

// TODO: apply this to all chart configs
export const setChartSelectsAlias = (config: ChartConfigWithOptDateRange) => {
  if (Array.isArray(config.select) && isMetric(config)) {
    return {
      ...config,
      select: config.select.map(s => ({
        ...s,
        alias: `${s.aggFn}(${s.metricName})`,
      })),
    };
  }
  return config;
};

export const splitChartConfigs = (config: ChartConfigWithOptDateRange) => {
  // only split metric queries for now
  if (isMetric(config) && Array.isArray(config.select)) {
    const _configs = [];
    // split the query into multiple queries
    for (const select of config.select) {
      _configs.push({
        ...config,
        select: [select],
      });
    }
    return _configs;
  }
  return [config];
};

// used for charting
export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>>,
) {
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<any>, ClickHouseQueryError | Error>({
    queryKey: [config],
    queryFn: async ({ signal }) => {
      config = setChartSelectsAlias(config);

      let query = null;
      if (IS_MTVIEWS_ENABLED) {
        const { dataTableDDL, mtViewDDL, renderMTViewConfig } =
          await buildMTViewSelectQuery(config);
        // TODO: show the DDLs in the UI so users can run commands manually
        // eslint-disable-next-line no-console
        console.log('dataTableDDL:', dataTableDDL);
        // eslint-disable-next-line no-console
        console.log('mtViewDDL:', mtViewDDL);
        query = await renderMTViewConfig();
      }

      const queries: ChSql[] = await Promise.all(
        splitChartConfigs(config).map(c => renderChartConfig(c, getMetadata())),
      );

      const resultSets = await Promise.all(
        queries.map(async query => {
          const resp = await clickhouseClient.query<'JSON'>({
            query: query.sql,
            query_params: query.params,
            format: 'JSON',
            abort_signal: signal,
            connectionId: config.connection,
          });
          return resp.json<any>();
        }),
      );

      if (resultSets.length === 1) {
        return resultSets[0];
      }
      // join resultSets
      else if (resultSets.length > 1) {
        const metaSet = new Map<string, { name: string; type: string }>();
        const tsBucketMap = new Map<string, Record<string, string | number>>();
        for (const resultSet of resultSets) {
          // set up the meta data
          if (Array.isArray(resultSet.meta)) {
            for (const meta of resultSet.meta) {
              const key = meta.name;
              if (!metaSet.has(key)) {
                metaSet.set(key, meta);
              }
            }
          }

          const timestampColumn = inferTimestampColumn(resultSet.meta ?? []);
          for (const row of resultSet.data) {
            const ts =
              timestampColumn != null
                ? row[timestampColumn.name]
                : '__FIXED_TIMESTAMP__';
            if (tsBucketMap.has(ts)) {
              const existingRow = tsBucketMap.get(ts);
              tsBucketMap.set(ts, {
                ...existingRow,
                ...row,
              });
            } else {
              tsBucketMap.set(ts, row);
            }
          }
        }

        return {
          meta: Array.from(metaSet.values()),
          data: Array.from(tsBucketMap.values()),
        };
      }
      throw new Error('No result sets');
    },
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });
}

export function useRenderedSqlChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: UseQueryOptions<string>,
) {
  return useQuery<string>({
    queryKey: ['renderedSql', config],
    queryFn: async () => {
      const query = await renderChartConfig(config, getMetadata());
      return format(parameterizedQueryToSql(query));
    },
    ...options,
  });
}

export function useAliasMapFromChartConfig(
  config: ChartConfigWithOptDateRange | undefined,
  options?: UseQueryOptions<Record<string, string>>,
) {
  return useQuery<Record<string, string>>({
    queryKey: ['aliasMap', config],
    queryFn: async () => {
      if (config == null) {
        return {};
      }

      const query = await renderChartConfig(config, getMetadata());

      const aliasMap = chSqlToAliasMap(query);

      return aliasMap;
    },
    enabled: config != null,
    ...options,
  });
}
