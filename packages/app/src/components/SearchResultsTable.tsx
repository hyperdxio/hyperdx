import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryState } from 'nuqs';
import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  ColumnMetaType,
  convertCHDataTypeToJSType,
  isJSDataTypeJSONStringifiable,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { MULTI_SOURCE_ALIASES } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconFilterOff } from '@tabler/icons-react';
import { SortingState } from '@tanstack/react-table';

import api from '@/api';
import { searchChartConfigDefaults } from '@/defaults';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere, { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { useMultiSourceSlots } from '@/hooks/useSourceSlots';
import {
  mergeStreams,
  MULTI_SOURCE_ROW_FIELDS,
  StreamSnapshot,
} from '@/utils/multiSourceMerge';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import ChartErrorState from './charts/ChartErrorState';
import DBRowSidePanel, {
  RowSidePanelContext,
  RowSidePanelContextProps,
} from './DBRowSidePanel';
import {
  DenoisedPatternsSummary,
  getSelectLength,
  RawLogTable,
  selectColumnMapWithoutAdditionalKeys,
  useConfigWithAdditionalSelect,
  useDenoisedRows,
} from './DBRowTable';
import { RowOverviewPanelWrapper } from './DBSqlRowTableWithSidebar';
import { getMultiSourceColor, SourceBadge } from './MultiSourceBadge';

/**
 * One selected source plus its fully-built chart config.
 *
 * With a single source the config carries that source's own SELECT (the user
 * authored it); with several, each config projects the canonical
 * MULTI_SOURCE_ALIASES so the merged rows share one shape.
 */
export type SearchStreamSpec = {
  source: TSource;
  config: BuilderChartConfigWithDateRange;
  /**
   * When set, the source doesn't run at all (e.g. an active filter references
   * a column its table lacks); shown on the source's status chip.
   */
  disabledReason?: string;
};

// Placeholder config for unused hook slots. The metadata hooks inside
// useConfigWithAdditionalSelect self-disable on empty table names, and the
// paginated query slot is explicitly disabled, so this never reaches
// ClickHouse.
const STUB_CONFIG: BuilderChartConfigWithDateRange = {
  connection: '',
  from: { databaseName: '', tableName: '' },
  timestampValueExpression: '',
  select: '',
  where: '',
  whereLanguage: 'sql',
  dateRange: [new Date(0), new Date(0)],
};

const EMPTY_CHSQL = { sql: '', params: {} };
const EMPTY_EXTRA_COLUMNS: string[] = [];

type SourceStream = {
  spec: SearchStreamSpec | undefined;
  data: ReturnType<typeof useOffsetPaginatedQuery>['data'];
  fetchNextPage: ReturnType<typeof useOffsetPaginatedQuery>['fetchNextPage'];
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | ClickHouseQueryError | null;
  getRowWhere: (row: Record<string, any>) => RowWhereResult;
  /** Row-identity columns appended to the SELECT, trimmed off for display. */
  additionalKeysLength: number | undefined;
};

/**
 * One source's independent query pipeline: the same
 * defaults → additional-key SELECT merge → windowed offset pagination →
 * row-WHERE machinery as the single-source DBSqlRowTable, packaged as a
 * useMultiSourceSlots slot hook. Unused slots get a stub config and stay
 * disabled.
 */
function useSourceStream(
  spec: SearchStreamSpec | undefined,
  {
    enabled,
    isLive,
    enableSmallFirstWindow,
    queryKeyPrefix,
  }: {
    enabled: boolean;
    isLive: boolean;
    enableSmallFirstWindow?: boolean;
    queryKeyPrefix?: string;
  },
): SourceStream {
  const { data: me } = api.useMe();

  const configWithDefaults = useMemo(
    () => ({
      ...searchChartConfigDefaults(me?.team),
      ...(spec?.config ?? STUB_CONFIG),
    }),
    [me, spec?.config],
  );

  const mergedConfig = useConfigWithAdditionalSelect(
    configWithDefaults,
    spec?.source.id,
  );

  const { data, fetchNextPage, hasNextPage, isFetching, isError, error } =
    useOffsetPaginatedQuery(mergedConfig ?? configWithDefaults, {
      enabled:
        enabled &&
        spec != null &&
        spec.disabledReason == null &&
        mergedConfig != null &&
        // An empty SELECT renders invalid SQL; wait for one to resolve.
        getSelectLength(spec.config.select) > 0,
      isLive,
      queryKeyPrefix,
      enableSmallFirstWindow,
    });

  const aliasMap = useMemo(() => {
    const map = chSqlToAliasMap(data?.chSql ?? EMPTY_CHSQL);
    // NULL-literal projections (`NULL AS "__hdx_duration_ms"` where a source
    // lacks the field) are dropped by the SQL alias parser. Backfill them so
    // the row-WHERE clause emits `isNull(NULL)` rather than referencing the
    // alias as a (nonexistent) table column. ClickHouse reports NULL literals
    // as Nullable(Nothing).
    for (const col of data?.meta ?? []) {
      if (map[col.name] == null && col.type === 'Nullable(Nothing)') {
        map[col.name] = 'NULL';
      }
    }
    return map;
  }, [data]);

  const getRowWhere = useRowWhere({
    meta: data?.meta,
    aliasMap,
    primaryKeyColumns: mergedConfig?.rowKeyColumns,
  });

  // Stable identity per content change, so downstream merge memos don't
  // recompute (and re-sort every fetched row) on unrelated parent renders.
  return useMemo(
    () => ({
      spec,
      data,
      fetchNextPage,
      hasNextPage: hasNextPage ?? false,
      isFetching,
      isError,
      error: error ?? null,
      getRowWhere,
      additionalKeysLength: mergedConfig?.additionalKeysLength,
    }),
    [
      spec,
      data,
      fetchNextPage,
      hasNextPage,
      isFetching,
      isError,
      error,
      getRowWhere,
      mergedConfig?.additionalKeysLength,
    ],
  );
}

const COLUMN_NAME_MAP: Record<string, string> = {
  [MULTI_SOURCE_ALIASES.timestamp]: 'Timestamp',
  [MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME]: 'Source',
  [MULTI_SOURCE_ALIASES.service]: 'Service',
  [MULTI_SOURCE_ALIASES.severity]: 'Level',
  [MULTI_SOURCE_ALIASES.durationMs]: 'Duration (ms)',
  [MULTI_SOURCE_ALIASES.body]: 'Message',
};

function StreamStatusChips({ streams }: { streams: SourceStream[] }) {
  return (
    <Group gap="xs" px="sm" py={4} wrap="wrap">
      {streams.map((stream, i) => {
        if (stream.spec == null) return null;
        const name = stream.spec.source.name;
        const disabledReason = stream.spec.disabledReason;
        return (
          <Group
            key={stream.spec.source.id}
            gap={4}
            wrap="nowrap"
            style={disabledReason != null ? { opacity: 0.55 } : undefined}
          >
            <SourceBadge name={name} color={getMultiSourceColor(i)} />
            {stream.isFetching && <Loader size={10} color="gray" />}
            {disabledReason != null && (
              <Tooltip label={disabledReason} multiline maw={420}>
                <Text component="span" c="dimmed" lh={1}>
                  <IconFilterOff size={13} />
                </Text>
              </Tooltip>
            )}
            {stream.isError && (
              <Tooltip
                label={`${name} failed to load and is excluded from these results: ${
                  stream.error?.message ?? 'unknown error'
                }`}
                multiline
                maw={420}
              >
                <Text component="span" c="yellow" lh={1}>
                  <IconAlertTriangle size={13} />
                </Text>
              </Tooltip>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

export default function SearchResultsTable({
  sources: specs,
  isLive,
  enabled = true,
  extraColumnNames = EMPTY_EXTRA_COLUMNS,
  denoiseResults = false,
  sortOrder,
  onSortingChange,
  onError,
  onResolvedColumnsChange,
  onScroll,
  onSidebarOpen,
  onExpandedRowsChange,
  collapseAllRows,
  enableSmallFirstWindow,
  tableId,
  context,
  keepOpenSelector,
  // Row queries are keyed separately from the page's chart/count queries, so
  // "is the search fetching?" (live-tail pause, latency telemetry) keeps
  // measuring the same thing it always has.
  queryKeyPrefix = 'dbSqlRowTable',
}: {
  /** 1..MAX_SEARCH_SOURCES selected sources with their built configs. */
  sources: SearchStreamSpec[];
  isLive: boolean;
  enabled?: boolean;
  /** User-picked extra columns projected into every source's SELECT (N>1). */
  extraColumnNames?: string[];
  /** Drop noisy event patterns from the results (single source only). */
  denoiseResults?: boolean;
  /** Current sort, for the single-source case where sorting is supported. */
  sortOrder?: SortingState;
  onSortingChange?: (v: SortingState | null) => void;
  /**
   * Surface a query failure to the page. Only called with a single source —
   * with several, a failing source is isolated to its own status chip rather
   * than failing the whole search.
   */
  onError?: (error: Error | ClickHouseQueryError) => void;
  onResolvedColumnsChange?: (meta: ColumnMetaType[]) => void;
  onScroll?: (scrollTop: number) => void;
  onSidebarOpen?: (rowId: string) => void;
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
  collapseAllRows?: boolean;
  enableSmallFirstWindow?: boolean;
  tableId?: string;
  context?: RowSidePanelContextProps;
  keepOpenSelector?: string;
  queryKeyPrefix?: string;
}) {
  const slots = useMultiSourceSlots(specs, useSourceStream, {
    enabled,
    isLive,
    enableSmallFirstWindow,
    queryKeyPrefix,
  });

  const streams = useMemo(
    () =>
      slots.filter(
        (s): s is SourceStream & { spec: SearchStreamSpec } => s.spec != null,
      ),
    [slots],
  );

  // With one source the table shows that source's own SELECT, sorts, and
  // denoises — everything the single-source search has always done. The
  // canonical aliases, source badges, and cross-source merge only come into
  // play once a second source is selected.
  const isSingleSource = specs.length === 1;
  const singleStream = isSingleSource ? streams[0] : undefined;

  const snapshots: StreamSnapshot[] = useMemo(
    () =>
      streams.map((stream, i) => ({
        sourceId: stream.spec.source.id,
        sourceName: stream.spec.source.name,
        sourceColor: getMultiSourceColor(i),
        rows: stream.data?.data ?? [],
        window: stream.data?.window ?? null,
        lastPageRowCount: stream.data?.lastPageRowCount ?? null,
        hasNextPage: stream.hasNextPage,
        isActive: !stream.isError && stream.spec.disabledReason == null,
        dateRange: stream.spec.config.dateRange,
      })),
    [streams],
  );

  // One source needs no merge: its rows already arrive timestamp-ordered from
  // its own ORDER BY, and there is no other stream to hold a frontier against.
  const merged = useMemo(
    () =>
      isSingleSource
        ? null
        : mergeStreams(snapshots, 'DESC', MULTI_SOURCE_ALIASES.timestamp),
    [isSingleSource, snapshots],
  );

  const columnTypeMap = useMemo(() => {
    if (singleStream != null) {
      // The user's SELECT columns, positionally trimmed of the row-identity
      // columns the query appends (same resolution as DBSqlRowTable).
      return selectColumnMapWithoutAdditionalKeys(
        singleStream.data?.meta,
        singleStream.additionalKeysLength,
      );
    }
    // Merge column meta across streams by canonical alias name, preferring a
    // resolved type over the Nullable(Nothing) a `NULL AS "alias"` projection
    // reports.
    const map = new Map<string, { _type: JSDataType | null }>();
    for (const stream of streams) {
      for (const col of stream.data?.meta ?? []) {
        const jsType = convertCHDataTypeToJSType(col.type);
        const existing = map.get(col.name);
        if (existing == null || existing._type == null) {
          map.set(col.name, { _type: jsType });
        }
      }
    }
    map.set(MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME, {
      _type: JSDataType.String,
    });
    return map;
  }, [streams, singleStream]);

  const includeDuration = specs.some(s => s.source.kind === SourceKind.Trace);

  const displayedColumns = useMemo(() => {
    if (isSingleSource) {
      return Array.from(columnTypeMap.keys());
    }
    return [
      MULTI_SOURCE_ALIASES.timestamp,
      MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME,
      MULTI_SOURCE_ALIASES.service,
      MULTI_SOURCE_ALIASES.severity,
      ...(includeDuration ? [MULTI_SOURCE_ALIASES.durationMs] : []),
      ...extraColumnNames,
      MULTI_SOURCE_ALIASES.body,
    ];
  }, [isSingleSource, columnTypeMap, includeDuration, extraColumnNames]);

  // Stringify object-typed cells (Map/Array/JSON) the same way DBSqlRowTable
  // does — both for display and because useRowWhere expects the stringified
  // form when rebuilding a row WHERE clause.
  const rows = useMemo(() => {
    const baseRows = singleStream
      ? (singleStream.data?.data ?? [])
      : (merged?.rows ?? []);
    const objectColumns = [...columnTypeMap.entries()]
      .filter(([, v]) => isJSDataTypeJSONStringifiable(v._type))
      .map(([name]) => name);
    if (objectColumns.length === 0) {
      return baseRows;
    }
    return baseRows.map(row => {
      const newRow = { ...row };
      for (const col of objectColumns) {
        if (!(col in newRow) || newRow[col] == null) continue;
        if (columnTypeMap.get(col)?._type === JSDataType.JSON) {
          newRow[col] = JSON.stringify(newRow[col]).replace(/\//g, '\\/');
        } else {
          newRow[col] = JSON.stringify(newRow[col]);
        }
      }
      return newRow;
    });
  }, [singleStream, merged?.rows, columnTypeMap]);

  const patternColumn = displayedColumns[displayedColumns.length - 1];
  const denoise = useDenoisedRows({
    config: singleStream?.spec.config ?? STUB_CONFIG,
    sourceId: singleStream?.spec.source.id,
    processedRows: rows,
    patternColumn,
    // Denoising mines patterns from one table's body column; it has no
    // cross-source meaning, so it only runs with a single source.
    denoiseResults: denoiseResults && isSingleSource,
    isLive,
  });

  // Row identity dispatches to the row's own stream: each stream has its own
  // result meta / alias map / primary-key columns. The client-side source tags
  // are stripped first — they aren't real columns.
  const generateRowId = useCallback(
    (row: Record<string, any>): RowWhereResult => {
      if (singleStream != null) {
        return singleStream.getRowWhere(row);
      }
      const {
        [MULTI_SOURCE_ROW_FIELDS.SOURCE_ID]: sourceId,
        [MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME]: _name,
        [MULTI_SOURCE_ROW_FIELDS.SOURCE_COLOR]: _color,
        ...dbRow
      } = row;
      const stream = streams.find(s => s.spec.source.id === sourceId);
      if (stream == null) {
        return { where: '', aliasWith: [] };
      }
      return stream.getRowWhere(dbRow);
    },
    [streams, singleStream],
  );

  // Advance only the stream(s) holding the frontier back; the leaders keep
  // their fetched-but-held rows until the laggards catch up.
  const fetchNextPage = useCallback(() => {
    if (singleStream != null) {
      singleStream.fetchNextPage({ cancelRefetch: false });
      return;
    }
    for (const sourceId of merged?.laggingSourceIds ?? []) {
      const stream = streams.find(s => s.spec.source.id === sourceId);
      stream?.fetchNextPage({ cancelRefetch: false });
    }
  }, [singleStream, merged?.laggingSourceIds, streams]);

  const hasNextPage = streams.some(s => !s.isError && s.hasNextPage);
  const isFetching = streams.some(s => s.isFetching);
  const isLoading = denoiseResults
    ? isFetching || denoise.isFetching
    : isFetching;
  const allFailed = streams.length > 0 && streams.every(s => s.isError);
  const firstError = streams.find(s => s.error != null)?.error ?? undefined;

  // A single source's failure is the whole search's failure, so the page owns
  // the error UI (and drops out of live tail), exactly as before.
  useEffect(() => {
    if (singleStream?.isError && singleStream.error != null) {
      onError?.(singleStream.error);
    }
  }, [singleStream?.isError, singleStream?.error, onError]);

  const singleMeta = singleStream?.data?.meta;
  useEffect(() => {
    if (singleMeta != null && singleMeta.length > 0) {
      onResolvedColumnsChange?.(singleMeta);
    }
  }, [singleMeta, onResolvedColumnsChange]);

  // Side panel wiring — the same URL-param contract as the legacy table,
  // except the panel's source comes from the clicked row rather than being
  // fixed for the page.
  const [rowId, setRowId] = useQueryState('rowWhere', parseAsStringEncoded);
  const [rowSource, setRowSource] = useQueryState('rowSource');
  const [aliasWith, setAliasWith] = useState<WithClause[]>([]);

  const onRowDetailsClick = useCallback(
    (row: Record<string, any>) => {
      const rowWhere = generateRowId(row);
      if (!rowWhere.where) return;
      setRowId(rowWhere.where);
      setAliasWith(rowWhere.aliasWith);
      setRowSource(
        row[MULTI_SOURCE_ROW_FIELDS.SOURCE_ID] ??
          singleStream?.spec.source.id ??
          null,
      );
      onSidebarOpen?.(rowWhere.where);
    },
    [generateRowId, setRowId, setRowSource, onSidebarOpen, singleStream],
  );

  const onCloseSidebar = useCallback(() => {
    setRowId(null);
    setRowSource(null);
  }, [setRowId, setRowSource]);

  const sourceForRow = useCallback(
    (id: unknown) =>
      specs.find(s => s.source.id === id)?.source ??
      // Links predating the rowSource param (and every single-source link)
      // carry only rowWhere; there is exactly one source it can belong to.
      (isSingleSource ? specs[0]?.source : undefined),
    [specs, isSingleSource],
  );

  const panelSource = useMemo(
    () => sourceForRow(rowSource),
    [sourceForRow, rowSource],
  );

  const renderRowDetails = useCallback(
    (r: { id: string; aliasWith?: WithClause[]; [key: string]: unknown }) => {
      const source = sourceForRow(r[MULTI_SOURCE_ROW_FIELDS.SOURCE_ID]);
      if (!source) {
        return <div className="p-3 text-muted">Loading...</div>;
      }
      return (
        <RowOverviewPanelWrapper
          source={source}
          rowId={r.id}
          aliasWith={r.aliasWith}
        />
      );
    },
    [sourceForRow],
  );

  const loadingDate = singleStream
    ? singleStream.data?.window?.direction === 'ASC'
      ? singleStream.data?.window?.endTime
      : singleStream.data?.window?.startTime
    : merged?.frontier != null && hasNextPage
      ? new Date(merged.frontier)
      : undefined;

  const firstConfig = streams[0]?.spec.config;

  return (
    <RowSidePanelContext value={context ?? {}}>
      {panelSource != null && (
        <DBRowSidePanel
          source={panelSource}
          rowId={rowId ?? undefined}
          aliasWith={aliasWith}
          onClose={onCloseSidebar}
          keepOpenSelector={keepOpenSelector}
        />
      )}
      <Flex direction="column" h="100%" mih={0}>
        {/* One source needs no legend: every row came from it. */}
        {!isSingleSource && <StreamStatusChips streams={streams} />}
        {denoiseResults && isSingleSource && (
          <DenoisedPatternsSummary
            noisyPatterns={denoise.noisyPatterns}
            hasNoisyPatterns={denoise.hasNoisyPatterns}
          />
        )}
        {allFailed && !isSingleSource ? (
          <ChartErrorState error={firstError ?? new Error('Search failed')} />
        ) : (
          <RawLogTable
            isLive={isLive}
            wrapLines={false}
            displayedColumns={displayedColumns}
            columnNameMap={isSingleSource ? undefined : COLUMN_NAME_MAP}
            highlightedLineId={rowId ?? undefined}
            rows={denoise.rows}
            isLoading={isLoading}
            fetchNextPage={fetchNextPage}
            hasNextPage={hasNextPage}
            onRowDetailsClick={onRowDetailsClick}
            generateRowId={generateRowId}
            onScroll={onScroll}
            columnTypeMap={columnTypeMap}
            dateRange={firstConfig?.dateRange}
            loadingDate={loadingDate}
            config={firstConfig}
            source={singleStream?.spec.source}
            renderRowDetails={renderRowDetails}
            onExpandedRowsChange={onExpandedRowsChange}
            collapseAllRows={collapseAllRows}
            // Sorting rewrites ORDER BY, which the windowed pagination and the
            // cross-source merge both key on — only safe with one source.
            enableSorting={isSingleSource}
            sortOrder={sortOrder}
            onSortingChange={onSortingChange}
            isError={isSingleSource ? singleStream?.isError : undefined}
            error={
              isSingleSource ? (singleStream?.error ?? undefined) : undefined
            }
            getRowWhere={generateRowId}
            tableId={tableId}
          />
        )}
      </Flex>
    </RowSidePanelContext>
  );
}
