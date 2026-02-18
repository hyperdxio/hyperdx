import { useMemo } from 'react';
import type { Row } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import type {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQueries } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { getEventBody } from '@/source';

const MULTI_SOURCE_PAGE_LIMIT = 200;

export type MultiSourceSearchRow = Record<string, unknown> & {
  _sourceId?: string;
  _sourceName?: string;
  _sortTime?: number;
};

async function fetchFirstSearchPage(
  config: ChartConfigWithDateRange,
  metadata: Parameters<typeof renderChartConfig>[1],
  source?: TSource | null,
): Promise<{
  data: Record<string, unknown>[];
  meta: { name: string; type: string }[];
}> {
  const clickhouseClient = getClickhouseClient();
  const windowedConfig = {
    ...config,
    dateRange: config.dateRange as [Date, Date],
    limit: {
      limit: config.limit?.limit ?? MULTI_SOURCE_PAGE_LIMIT,
      offset: 0,
    },
  };
  const query = await renderChartConfig(
    windowedConfig,
    metadata,
    source?.querySettings,
  );
  const resultSet =
    await clickhouseClient.query<'JSONCompactEachRowWithNamesAndTypes'>({
      query: query.sql,
      query_params: query.params,
      format: 'JSONCompactEachRowWithNamesAndTypes',
      connectionId: config.connection,
    });
  const stream = resultSet.stream();
  const reader = stream.getReader();
  const rows: Row<unknown[], 'JSONCompactEachRowWithNamesAndTypes'>[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done || value == null) break;
    rows.push(...value);
  }
  const meta: { name: string; type: string }[] = [];
  if (rows.length < 2) {
    return { data: [], meta: [] };
  }
  const names = rows[0].json<string[]>();
  const types = rows[1].json<string[]>();
  if (names.length !== types.length) {
    throw new Error('Invalid JSONCompactEachRowWithNamesAndTypes header rows');
  }
  for (let i = 0; i < names.length; i++) {
    meta.push({ name: names[i], type: types[i] });
  }
  const data: Record<string, unknown>[] = [];
  for (let i = 2; i < rows.length; i++) {
    const rowArr = rows[i].json();
    const rowObj: Record<string, unknown> = {};
    for (let j = 0; j < rowArr.length; j++) {
      rowObj[meta[j].name] = rowArr[j];
    }
    data.push(rowObj);
  }
  return { data, meta };
}

function getSortTime(
  row: Record<string, unknown>,
  meta: { name: string }[],
): number {
  const tsCol = meta.find(m => /timestamp|time|Timestamp|Time/i.test(m.name));
  const val = tsCol ? row[tsCol.name] : undefined;
  if (val == null) return 0;
  if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
  if (typeof val === 'string') {
    const n = Date.parse(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export function useMultiSourceSearchResults(
  configs: (ChartConfigWithDateRange & { source: string })[],
  sourceNamesById: Map<string, string>,
  sourcesById: Map<string, TSource>,
  enabled: boolean,
): {
  data: MultiSourceSearchRow[] | null;
  meta: { name: string; type: string }[] | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const metadata = useMetadataWithSettings();
  const sourceQueries = useQueries({
    queries: configs.map(c => ({
      queryKey: ['multiSourceSearch', c.source, c.dateRange, c.where] as const,
      queryFn: async () => {
        const source = sourcesById.get(c.source);
        return fetchFirstSearchPage(c, metadata as any, source);
      },
      enabled: enabled && configs.length > 0 && !!metadata,
    })),
  });
  const sourcesData = sourceQueries.map((q, i) =>
    q?.data != null
      ? {
          config: configs[i],
          data: q.data as {
            data: Record<string, unknown>[];
            meta: { name: string; type: string }[];
          },
        }
      : null,
  );
  const isLoading = sourceQueries.some(q => q.isLoading);
  const isError = sourceQueries.some(q => q.isError);
  const error =
    (sourceQueries.find(q => q.error)?.error as Error | undefined) ?? null;

  const merged = useMemo(() => {
    const successful = sourcesData.filter(
      (s): s is NonNullable<typeof s> => s != null,
    );
    if (successful.length === 0) return null;
    const allRows: MultiSourceSearchRow[] = [];
    let needsBodyInMeta = false;
    for (let i = 0; i < sourcesData.length; i++) {
      const s = sourcesData[i];
      if (s == null) continue;
      const { config, data: res } = s;
      const rows = res.data;
      const rowMeta = res.meta;
      const sourceName = sourceNamesById.get(config.source) ?? config.source;
      const source = sourcesById.get(config.source);
      const bodyColumnName = source ? getEventBody(source) : null;
      for (const row of rows) {
        const sortTime = getSortTime(row, rowMeta);
        const mergedRow: MultiSourceSearchRow = {
          ...row,
          _sourceId: config.source,
          _sourceName: sourceName,
          _sortTime: sortTime,
        };
        if (
          bodyColumnName &&
          bodyColumnName !== 'Body' &&
          row[bodyColumnName] != null
        ) {
          mergedRow.Body = row[bodyColumnName];
          needsBodyInMeta = true;
        }
        allRows.push(mergedRow);
      }
    }
    allRows.sort((a, b) => (b._sortTime ?? 0) - (a._sortTime ?? 0));
    const firstMeta = successful[0]?.data.meta ?? [];
    const hasBodyInMeta = firstMeta.some(m => m.name === 'Body');
    const meta =
      allRows.length > 0
        ? [
            ...firstMeta.filter(
              m =>
                m.name !== '_sourceId' &&
                m.name !== '_sourceName' &&
                m.name !== '_sortTime',
            ),
            ...(needsBodyInMeta && !hasBodyInMeta
              ? [{ name: 'Body', type: 'String' as const }]
              : []),
            { name: '_sourceName', type: 'String' },
            { name: '_sourceId', type: 'String' },
          ]
        : [];
    return { data: allRows, meta };
  }, [sourcesData, sourceNamesById, sourcesById]);

  return {
    data: merged?.data ?? null,
    meta: merged?.meta ?? null,
    isLoading,
    isError,
    error,
  };
}
