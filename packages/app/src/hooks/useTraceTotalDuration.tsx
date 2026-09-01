import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import SqlString from 'sqlstring';

import { useClickhouseClient } from '@/clickhouse';
import {
  getDisplayedTimestampValueExpression,
  getDurationMsExpression,
  useSource,
} from '@/source';

import { useMetadataWithSettings } from './useMetadata';

type TraceTotalDurationResult = {
  totalDurationMs: number;
  spanCount: number;
};

// Wall-clock span of a single trace: MAX(span end) - MIN(span start) across
// every span belonging to the trace, computed server-side so it's correct
// even before the paginated results table has fetched every row (#3038).
export function useTraceTotalDuration(
  _config: ChartConfigWithOptDateRange,
  traceId: string | undefined,
  options?: Omit<
    UseQueryOptions<TraceTotalDurationResult>,
    'queryKey' | 'queryFn'
  >,
) {
  const { enabled, ...restOptions } = options ?? {};

  const config = {
    ..._config,
    with: undefined,
  };

  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();

  const { data: source, isLoading: isSourceLoading } = useSource({
    id: config.source,
  });

  return useQuery({
    queryKey: ['trace-total-duration', config, traceId],
    queryFn: async ({ signal }) => {
      if (!traceId || !source || source.kind !== SourceKind.Trace) {
        return { totalDurationMs: 0, spanCount: 0 };
      }

      const timestampExpr = getDisplayedTimestampValueExpression(source);
      const durationMsExpr = getDurationMsExpression(source);

      const aggConfig: ChartConfigWithOptDateRange = {
        ...config,
        select: `MIN(${timestampExpr}) AS minTs, MAX(${timestampExpr} + toIntervalMillisecond(toInt64(${durationMsExpr}))) AS maxTs, COUNT(*) AS spanCount`,
        where: `${source.traceIdExpression} = ${SqlString.escape(traceId)}`,
        whereLanguage: 'sql',
        orderBy: undefined,
        groupBy: undefined,
      };

      const query = await renderChartConfig(
        aggConfig,
        metadata,
        source.querySettings,
      );
      const response = await clickhouseClient.query<'JSONEachRow'>({
        query: query.sql,
        query_params: query.params,
        format: 'JSONEachRow',
        abort_signal: signal,
        connectionId: config.connection,
      });
      const [row] = await response.json<{
        minTs: string;
        maxTs: string;
        spanCount: string;
      }>();
      if (!row) {
        return { totalDurationMs: 0, spanCount: 0 };
      }
      return {
        totalDurationMs:
          new Date(row.maxTs).getTime() - new Date(row.minTs).getTime(),
        spanCount: Number(row.spanCount),
      };
    },
    retry: false,
    staleTime: 1000 * 60,
    enabled: enabled && !!traceId && !isSourceLoading,
    ...restOptions,
  });
}