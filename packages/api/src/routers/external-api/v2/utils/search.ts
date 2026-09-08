import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { resolveSearchOrderBy } from '@/utils/searchOrderBy';
import type { ExternalDashboardSearchRequestConfig } from '@/utils/zod';

export type SearchErrorCode = 'SOURCE_NOT_FOUND' | 'CONNECTION_NOT_FOUND';

type SearchError = {
  isError: true;
  code: SearchErrorCode;
  message: string;
};

type SearchResults = {
  isError: false;
  data: Record<string, unknown>[];
};

export async function runSearchConfig({
  teamId,
  config,
  startDate,
  endDate,
  maxResults,
  offset,
}: {
  teamId: string;
  config: ExternalDashboardSearchRequestConfig;
  startDate: Date;
  endDate: Date;
  maxResults: number;
  offset: number;
}): Promise<SearchResults | SearchError> {
  const source = await getSource(teamId, config.sourceId);
  if (!source) {
    return {
      isError: true,
      code: 'SOURCE_NOT_FOUND',
      message: `Source not found: ${config.sourceId}`,
    };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return {
      isError: true,
      code: 'CONNECTION_NOT_FOUND',
      message: `Connection not found for source: ${config.sourceId}`,
    };
  }

  // Set client-side HTTP timeout slightly above the source's max_execution_time
  // so CH can return a clean error first. value=0 means no server limit.
  const maxExecSetting = source.querySettings?.find(
    s => s.setting === 'max_execution_time',
  );
  const maxExecSeconds = maxExecSetting ? Number(maxExecSetting.value) : NaN;
  const requestTimeout =
    maxExecSeconds > 0 && isFinite(maxExecSeconds)
      ? maxExecSeconds * 1000 + 2_000
      : undefined;

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    ...(requestTimeout != null ? { requestTimeout } : {}),
  });

  const searchBase = buildSearchChartConfig(source, {
    where: typeof config.where === 'string' ? config.where : '',
    whereLanguage: config.whereLanguage ?? 'lucene',
    select: config.select ?? null,
    displayType: DisplayType.Search,
    orderBy: config.orderBy?.trim() || resolveSearchOrderBy(source),
    dateRange: [startDate, endDate],
  });

  const chartConfig: ChartConfigWithDateRange = {
    ...searchBase,
    connection: source.connection.toString(),
    limit: { limit: maxResults, offset },
  } as ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: source.querySettings,
  });

  if (
    result == null ||
    typeof result !== 'object' ||
    !('data' in result) ||
    !Array.isArray((result as { data: unknown }).data)
  ) {
    throw new Error('Unexpected ClickHouse response shape: missing data array');
  }

  return {
    isError: false,
    data: (result as { data: unknown[] }).data as Record<string, unknown>[],
  };
}
