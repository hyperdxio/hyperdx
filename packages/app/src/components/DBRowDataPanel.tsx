import { useMemo } from 'react';
import { splitAndTrimWithBracket } from '@berg/common-utils/dist/core/utils';
import { TSource } from '@berg/common-utils/dist/types';
import { Box, Group, Loader, Text } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { WithClause } from '@/hooks/useRowWhere';

import { DBRowJsonViewer } from './DBRowJsonViewer';

export enum ROW_DATA_ALIASES {
  TIMESTAMP = '__hdx_timestamp',
  BODY = '__hdx_body',
  TRACE_ID = '__hdx_trace_id',
  SPAN_ID = '__hdx_span_id',
  SEVERITY_TEXT = '__hdx_severity_text',
  SERVICE_NAME = '__hdx_service_name',
  RESOURCE_ATTRIBUTES = '__hdx_resource_attributes',
  EVENT_ATTRIBUTES = '__hdx_event_attributes',
  EVENTS_EXCEPTION_ATTRIBUTES = '__hdx_events_exception_attributes',
  SPAN_EVENTS = '__hdx_span_events',
}

/**
 * Whether a SELECT clause contains a top-level `*` (i.e. all source columns
 * are guaranteed to be in the result row, so the inline-expand panel does
 * not need to re-fetch the row from Athena).
 *
 * Only star expressions that are themselves a SELECT entry count — a literal
 * `'*'` inside a string or alias is ignored because `splitAndTrimWithBracket`
 * preserves quoted segments as-is.
 */
export function selectIncludesStar(selectStr: string): boolean {
  if (!selectStr) return false;
  return splitAndTrimWithBracket(selectStr).some(e => e.trim() === '*');
}

export function useRowData({
  source,
  rowId,
  aliasWith,
  prefetchedRow,
  tableSelect,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  /**
   * The row already returned by the main results-table query. When
   * provided, the inline-expand panel renders it immediately as
   * placeholder data (so the panel doesn't show an empty loading state
   * while we wait for an effectively-redundant `SELECT * WHERE rowId`
   * round-trip).
   */
  prefetchedRow?: Record<string, any>;
  /**
   * The main table's SELECT string. Used to decide whether the
   * `prefetchedRow` already contains every source column — if so, we
   * can skip the row-detail fetch entirely.
   */
  tableSelect?: string;
}) {
  const canUsePrefetched =
    !!prefetchedRow && !!tableSelect && selectIncludesStar(tableSelect);

  // Synthesise a result-set shape the rest of the panel expects when we
  // skip the network call. `__hdx_timestamp` is normally added by the
  // detail-panel SELECT alias; recover it from the source's
  // `timestampColumn` so the header date still renders.
  const placeholder = useMemo(() => {
    if (!prefetchedRow) return undefined;
    const ts = source.timestampColumn
      ? prefetchedRow[source.timestampColumn]
      : undefined;
    const row = {
      ...prefetchedRow,
      [ROW_DATA_ALIASES.TIMESTAMP]:
        prefetchedRow[ROW_DATA_ALIASES.TIMESTAMP] ?? ts,
    };
    return { data: [row], meta: [], rows: 1, isComplete: true } as any;
  }, [prefetchedRow, source.timestampColumn]);

  const queryResult = useQueriedChartConfig(
    {
      // Berg routes catalog/QueryExecutionContext resolution through
      // `chartConfig.connection` (= source id). An empty string here
      // makes the API fall back to `cfg.GLUE_CATALOG_ID`, which on
      // multi-catalog deployments points at the wrong catalog and the
      // row-detail SELECT silently returns no rows. Stamp the source id
      // so the bridge resolves the right catalog/database.
      connection: source.id,
      select: [
        { valueExpression: '*' },
        ...(source.timestampColumn
          ? [
              {
                valueExpression: source.timestampColumn,
                alias: ROW_DATA_ALIASES.TIMESTAMP,
              },
            ]
          : []),
      ],
      where: rowId ?? '0=1',
      from: { databaseName: source.database, tableName: source.table },
      limit: { limit: 1 },
      ...(aliasWith && aliasWith.length > 0 ? { with: aliasWith } : {}),
    },
    {
      // Key on `source.id` rather than the whole source object — the API
      // mutates `lastQueriedAt`/`updatedAt` on every query, which churns
      // the source reference and would otherwise spawn a fresh query
      // (and orphan the old one) every few seconds in the side panel.
      queryKey: ['row_side_panel', rowId, aliasWith, source.id],
      enabled: rowId != null && !canUsePrefetched,
      // A specific row's data is immutable once fetched (logs are
      // append-only). Without this, React Query's default `staleTime: 0`
      // re-fires the same `SELECT * WHERE rowId` whenever a sibling
      // subscriber mounts — e.g. switching between the Overview and
      // Column Values tabs in the inline expand triples the cost for
      // no new data. `refetchOnWindowFocus: false` covers the parallel
      // case where re-focusing the tab triggers an extra round-trip.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      // Show the table row instantly while the (possibly redundant)
      // `SELECT * WHERE rowId` round-trip is still in flight.
      placeholderData: placeholder,
    },
  );

  // When `canUsePrefetched`, the underlying query is `enabled: false` and
  // returns `data: undefined`. Surface the synthesised row in its place so
  // consumers see a populated `data.data[0]` immediately.
  if (canUsePrefetched && placeholder) {
    return {
      ...queryResult,
      data: queryResult.data ?? placeholder,
      isLoading: false,
      isSuccess: true,
    } as typeof queryResult;
  }

  return queryResult;
}

export function getJSONColumnNames(
  meta: { name: string; type: string }[] | undefined,
) {
  return (
    meta
      ?.filter(m => m.type === 'JSON' || m.type.startsWith('JSON('))
      .map(m => m.name) ?? []
  );
}

export function RowDataPanel({
  source,
  rowId,
  aliasWith,
  prefetchedRow,
  tableSelect,
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  prefetchedRow?: Record<string, any>;
  tableSelect?: string;
  'data-testid'?: string;
}) {
  const { data, isFetching } = useRowData({
    source,
    rowId,
    aliasWith,
    prefetchedRow,
    tableSelect,
  });

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const jsonColumns = getJSONColumnNames(data?.meta);
  // We already render `firstRow` from the table's in-memory placeholder
  // data; the indicator only signals that more (or fresher) fields are
  // still on the way from the row-detail fetch.
  const showFetchingIndicator = isFetching && firstRow != null;

  return (
    <div className="flex-grow-1 overflow-auto" data-testid={dataTestId}>
      <Box mx="md" my="sm">
        {showFetchingIndicator && (
          <Group gap="xxs" align="center" mb="xs">
            <Loader size="xs" type="dots" />
            <Text size="xs" c="dimmed">
              Loading additional fields…
            </Text>
          </Group>
        )}
        <DBRowJsonViewer data={firstRow} jsonColumns={jsonColumns} />
      </Box>
    </div>
  );
}
