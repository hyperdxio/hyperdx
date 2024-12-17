import { format } from 'sql-formatter';
import { ResponseJSON } from '@clickhouse/client-web';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import {
  ClickHouseQueryError,
  parameterizedQueryToSql,
  sendQuery,
} from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import {
  ChartConfigWithOptDateRange,
  renderChartConfig,
} from '@/renderChartConfig';

export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>>,
) {
  return useQuery<ResponseJSON<any>, ClickHouseQueryError | Error>({
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
      if (query == null) {
        query = await renderChartConfig(config);
      }

      const resultSet = await sendQuery<'JSON'>({
        query: query.sql,
        query_params: query.params,
        format: 'JSON',
        abort_signal: signal,
        connectionId: config.connection,
      });

      return resultSet.json();
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
      const query = await renderChartConfig(config);

      return format(parameterizedQueryToSql(query));
    },
    ...options,
  });
}
