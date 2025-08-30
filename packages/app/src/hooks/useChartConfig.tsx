import { useEffect } from 'react';
import objectHash from 'object-hash';
import {
  ChSql,
  chSqlToAliasMap,
  ClickHouseQueryError,
  inferNumericColumn,
  inferTimestampColumn,
  parameterizedQueryToSql,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { getMetadata } from '@/metadata';

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
}

// used for charting
export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>> &
    AdditionalUseQueriedChartConfigOptions,
) {
  const clickhouseClient = useClickhouseClient();
  const query = useQuery<ResponseJSON<any>, ClickHouseQueryError | Error>({
    queryKey: [config],
    queryFn: async ({ signal }) => {
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

      return clickhouseClient.queryChartConfig({
        config,
        metadata: getMetadata(),
        opts: {
          abort_signal: signal,
        },
      });
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
