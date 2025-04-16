import { useEffect } from 'react';
import objectHash from 'object-hash';
import { ResponseJSON } from '@clickhouse/client-web';
import {
  ChSql,
  chSqlToAliasMap,
  ClickHouseQueryError,
  inferNumericColumn,
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

const castToNumber = (value: string | number) => {
  if (typeof value === 'string') {
    if (value.trim() === '') {
      return NaN;
    }
    return Number(value);
  }
  return value;
};

export const computeRatio = (
  numeratorInput: string | number,
  denominatorInput: string | number,
) => {
  const numerator = castToNumber(numeratorInput);
  const denominator = castToNumber(denominatorInput);

  if (isNaN(numerator) || isNaN(denominator) || denominator === 0) {
    return NaN;
  }

  return numerator / denominator;
};

export const computeResultSetRatio = (resultSet: ResponseJSON<any>) => {
  const _meta = resultSet.meta;
  const _data = resultSet.data;
  const timestampColumn = inferTimestampColumn(_meta ?? []);
  const _restColumns = _meta?.filter(m => m.name !== timestampColumn?.name);
  const firstColumn = _restColumns?.[0];
  const secondColumn = _restColumns?.[1];
  if (!firstColumn || !secondColumn) {
    throw new Error(
      `Unable to compute ratio - meta information: ${JSON.stringify(_meta)}.`,
    );
  }
  const ratioColumnName = `${firstColumn.name}/${secondColumn.name}`;
  const result = {
    ...resultSet,
    data: _data.map(row => ({
      [ratioColumnName]: computeRatio(
        row[firstColumn.name],
        row[secondColumn.name],
      ),
      ...(timestampColumn
        ? {
            [timestampColumn.name]: row[timestampColumn.name],
          }
        : {}),
    })),
    meta: [
      {
        name: ratioColumnName,
        type: 'Float64',
      },
      ...(timestampColumn
        ? [
            {
              name: timestampColumn.name,
              type: timestampColumn.type,
            },
          ]
        : []),
    ],
  };
  return result;
};

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
}

// used for charting
export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>> &
    AdditionalUseQueriedChartConfigOptions,
) {
  const clickhouseClient = getClickhouseClient();
  const query = useQuery<ResponseJSON<any>, ClickHouseQueryError | Error>({
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

      // TODO: move multi-series logics to common-utils so alerting can use it
      const queries: ChSql[] = await Promise.all(
        splitChartConfigs(config).map(c => renderChartConfig(c, getMetadata())),
      );

      const isTimeSeries = config.displayType === 'line';

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
        const isRatio =
          config.seriesReturnType === 'ratio' &&
          resultSets[0].meta?.length === 3;
        return isRatio ? computeResultSetRatio(resultSets[0]) : resultSets[0];
      }
      // metrics -> join resultSets
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
          const numericColumn = inferNumericColumn(resultSet.meta ?? []);
          const numericColumnName = numericColumn?.[0]?.name;
          for (const row of resultSet.data) {
            const _rowWithoutValue = numericColumnName
              ? Object.fromEntries(
                  Object.entries(row).filter(
                    ([key]) => key !== numericColumnName,
                  ),
                )
              : { ...row };
            const ts =
              timestampColumn != null
                ? row[timestampColumn.name]
                : isTimeSeries
                  ? objectHash(_rowWithoutValue)
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

        const isRatio =
          config.seriesReturnType === 'ratio' && resultSets.length === 2;

        const _resultSet = {
          meta: Array.from(metaSet.values()),
          data: Array.from(tsBucketMap.values()),
        };
        return isRatio ? computeResultSetRatio(_resultSet) : _resultSet;
      }
      throw new Error('No result sets');
    },
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });
  if (query.isError && options?.onError) {
    options.onError(query.error);
  }
  return query;
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
