import { useQuery } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';

type MetricNameRow = { metric_name: string };
type LabelNameRow = { label_name: string };
type InnerTableRow = { name: string };

/**
 * Discovers the inner tags table name for a TimeSeries table.
 * TimeSeries engine creates inner tables named `.inner_id.tags.<UUID>` —
 * we look them up via system.tables since the UUID is auto-generated.
 */
async function findInnerTagsTable(
  clickhouseClient: ReturnType<typeof useClickhouseClient>,
  connectionId: string,
  database: string,
  timeSeriesTable: string,
) {
  const resp = await clickhouseClient.query<'JSON'>({
    query: `SELECT name FROM system.tables WHERE database = {db:String} AND name LIKE concat('.inner_id.tags.', (SELECT toString(uuid) FROM system.tables WHERE database = {db:String} AND name = {table:String}))`,
    query_params: { db: database, table: timeSeriesTable },
    format: 'JSON',
    connectionId,
    clickhouse_settings: {
      allow_experimental_time_series_table: 1,
    },
  });
  const json = await resp.json<InnerTableRow>();
  return json.data[0]?.name;
}

export function usePromqlMetricNames(
  connectionId: string | undefined,
  database?: string,
  table?: string,
) {
  const clickhouseClient = useClickhouseClient();
  const db = database || 'default';
  const tbl = table || 'otel_metrics_ts';

  return useQuery<string[]>({
    queryKey: ['promql-metric-names', connectionId, db, tbl],
    queryFn: async () => {
      if (!connectionId) return [];

      const tagsTable = await findInnerTagsTable(
        clickhouseClient,
        connectionId,
        db,
        tbl,
      );
      if (!tagsTable) return [];

      const resp = await clickhouseClient.query<'JSON'>({
        query: `SELECT DISTINCT metric_name FROM {table:Identifier} ORDER BY metric_name`,
        query_params: { table: tagsTable },
        format: 'JSON',
        connectionId,
        clickhouse_settings: {
          allow_experimental_time_series_table: 1,
        },
      });
      const json = await resp.json<MetricNameRow>();
      return json.data.map(row => row.metric_name);
    },
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}

export function usePromqlLabelNames(
  connectionId: string | undefined,
  metricName: string | undefined,
  database?: string,
  table?: string,
) {
  const clickhouseClient = useClickhouseClient();
  const db = database || 'default';
  const tbl = table || 'otel_metrics_ts';

  return useQuery<string[]>({
    queryKey: ['promql-label-names', connectionId, metricName, db, tbl],
    queryFn: async () => {
      if (!connectionId || !metricName) return [];

      const tagsTable = await findInnerTagsTable(
        clickhouseClient,
        connectionId,
        db,
        tbl,
      );
      if (!tagsTable) return [];

      const resp = await clickhouseClient.query<'JSON'>({
        query: `SELECT DISTINCT arrayJoin(mapKeys(all_tags)) AS label_name FROM {table:Identifier} WHERE metric_name = {name:String} ORDER BY label_name`,
        query_params: { table: tagsTable, name: metricName },
        format: 'JSON',
        connectionId,
        clickhouse_settings: {
          allow_experimental_time_series_table: 1,
        },
      });
      const json = await resp.json<LabelNameRow>();
      return json.data.map(row => row.label_name);
    },
    enabled: !!connectionId && !!metricName,
    staleTime: 60_000,
  });
}
