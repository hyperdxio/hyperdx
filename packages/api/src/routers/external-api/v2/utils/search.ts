import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  isLogSource,
  isTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
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

// Mirrors `optimizeDefaultOrderBy` + `useDefaultOrderBy` from DBSearchPage.tsx.
// Uses `source.orderByExpression` when set, otherwise derives an ORDER BY string
// from the source's timestamp expressions.
//
// The UI version also folds in `tableMetadata.sorting_key` (fetched from CH) to
// pick up extra timestamp-like columns from the table's sort key. We skip that
// step here to avoid an extra CH round-trip on the critical path. Sources that
// need the full sorting-key-aware behaviour should set `orderByExpression`.
export function resolveSearchOrderBy(source: TSource): string {
  const explicit =
    isLogSource(source) || isTraceSource(source)
      ? source.orderByExpression?.trim()
      : undefined;
  if (explicit) return explicit;

  const timestampExpr = source.timestampValueExpression ?? '';
  const displayedExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.displayedTimestampValueExpression?.trim()
      : undefined;

  const timestampParts = splitAndTrimWithBracket(timestampExpr);
  const candidates = displayedExpr
    ? [...timestampParts, displayedExpr]
    : [...timestampParts];

  const seen = new Set<string>();
  const orderByParts: string[] = [];
  for (const key of candidates) {
    if (!seen.has(key)) {
      seen.add(key);
      orderByParts.push(key);
    }
  }

  if (orderByParts.length === 0) {
    orderByParts.push(
      getFirstTimestampValueExpression(timestampExpr) ?? 'Timestamp',
    );
  }

  return orderByParts.length > 1
    ? `(${orderByParts.join(', ')}) DESC`
    : `${orderByParts[0]} DESC`;
}

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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
