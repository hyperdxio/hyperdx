import type {
  ClickHouseProgress,
  ColumnMetaType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { supportsJSONEachRowWithProgressMeta } from '@hyperdx/common-utils/dist/core/clickhouseVersion';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  renderChartConfig,
  setChartSelectsAlias,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  QuerySettings,
} from '@hyperdx/common-utils/dist/types';

import { createEachRowWithProgressParser } from '@/utils/clickhouseStream';

type ChartQueryResult = ResponseJSON<Record<string, string | number>>;

/** One NDJSON line from a ClickHouse result stream, before decoding. */
type StreamedRow = { json: () => unknown };

/**
 * Runs a chart config like `ClickhouseClient.queryChartConfig`, but streams the
 * response so ClickHouse's `{"progress":...}` events can be reported while the
 * query runs.
 *
 * Falls back to the plain (non-streaming) `queryChartConfig` when the server
 * predates the `meta`/`exception` events of `JSONEachRowWithProgress` (< 25.1),
 * or when its version cannot be determined.
 */
export async function queryChartConfigWithProgress({
  config,
  clickhouseClient,
  metadata,
  querySettings,
  signal,
  clickhouseSettings,
  onProgress,
}: {
  config: ChartConfigWithOptDateRange;
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
  querySettings: QuerySettings | undefined;
  signal?: AbortSignal;
  clickhouseSettings?: Record<string, any>;
  onProgress?: (progress: ClickHouseProgress) => void;
}): Promise<ChartQueryResult> {
  const connectionId = config.connection;
  const canStreamProgress =
    onProgress != null &&
    connectionId != null &&
    supportsJSONEachRowWithProgressMeta(
      await metadata.getServerVersion({ connectionId }),
    );

  if (!canStreamProgress) {
    return clickhouseClient.queryChartConfig({
      config,
      metadata,
      opts: { abort_signal: signal, clickhouse_settings: clickhouseSettings },
      querySettings,
    });
  }

  const aliasedConfig = isBuilderChartConfig(config)
    ? setChartSelectsAlias(config)
    : config;
  const query = await renderChartConfig(aliasedConfig, metadata, querySettings);

  const resultSet = await clickhouseClient.query<'JSONEachRowWithProgress'>({
    query: query.sql,
    query_params: query.params,
    format: 'JSONEachRowWithProgress',
    abort_signal: signal,
    connectionId,
    clickhouse_settings: clickhouseSettings,
  });

  const data: Record<string, string | number>[] = [];
  let meta: ColumnMetaType[] = [];

  const parseBatch = createEachRowWithProgressParser(
    {
      onMeta: nextMeta => {
        meta = nextMeta;
      },
      onRows: rows => {
        // Rows arrive already keyed by column name in this format.
        data.push(...(rows as Record<string, string | number>[]));
      },
      onProgress,
    },
    query.sql,
  );

  // The parser only needs each line decoded, so narrow to that shared shape.
  const stream: ReadableStream<StreamedRow[]> = resultSet.stream();
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done || value == null) break;
    parseBatch(value.map(row => row.json()));
  }

  return { data, meta, rows: data.length };
}
