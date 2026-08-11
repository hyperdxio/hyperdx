import { useCallback, useMemo, useState } from 'react';
import { useQueryState } from 'nuqs';
import {
  chSqlToAliasMap,
  ClickHouseQueryError,
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
import { IconAlertTriangle } from '@tabler/icons-react';

import api from '@/api';
import { searchChartConfigDefaults } from '@/defaults';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere, { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
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
import { RawLogTable, useConfigWithAdditionalSelect } from './DBRowTable';
import { RowOverviewPanelWrapper } from './DBSqlRowTableWithSidebar';
import { getMultiSourceColor, SourceBadge } from './MultiSourceBadge';

/** One selected source plus its fully-built (canonical-SELECT) chart config. */
export type MultiSourceStreamSpec = {
  source: TSource;
  config: BuilderChartConfigWithDateRange;
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
  spec: MultiSourceStreamSpec | undefined;
  data: ReturnType<typeof useOffsetPaginatedQuery>['data'];
  fetchNextPage: ReturnType<typeof useOffsetPaginatedQuery>['fetchNextPage'];
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | ClickHouseQueryError | null;
  getRowWhere: (row: Record<string, any>) => RowWhereResult;
};

/**
 * One source's independent query pipeline: the same
 * defaults → additional-key SELECT merge → windowed offset pagination →
 * row-WHERE machinery as the single-source DBSqlRowTable, packaged per slot.
 *
 * Always called (fixed hook count — see MAX_SEARCH_SOURCES); unused slots get
 * a stub config and stay disabled.
 */
function useSourceStream(
  spec: MultiSourceStreamSpec | undefined,
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
      enabled: enabled && spec != null && mergedConfig != null,
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
        return (
          <Group key={stream.spec.source.id} gap={4} wrap="nowrap">
            <SourceBadge name={name} color={getMultiSourceColor(i)} />
            {stream.isFetching && <Loader size={10} color="gray" />}
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

export default function MultiSourceRowTableWithSidebar({
  streams: specs,
  isLive,
  enabled = true,
  extraColumnNames = EMPTY_EXTRA_COLUMNS,
  onScroll,
  onSidebarOpen,
  onExpandedRowsChange,
  collapseAllRows,
  enableSmallFirstWindow,
  tableId,
  context,
  keepOpenSelector,
  queryKeyPrefix,
}: {
  /** 2..MAX_SEARCH_SOURCES selected sources with their built configs. */
  streams: MultiSourceStreamSpec[];
  isLive: boolean;
  enabled?: boolean;
  /** User-picked extra columns projected into every source's SELECT. */
  extraColumnNames?: string[];
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
  const streamOpts = {
    enabled,
    isLive,
    enableSmallFirstWindow,
    queryKeyPrefix,
  };

  // Fixed hook slots (MAX_SEARCH_SOURCES = 5): hook count stays constant no
  // matter how many sources are selected, so no rules-of-hooks gymnastics.
  const slot0 = useSourceStream(specs[0], streamOpts);
  const slot1 = useSourceStream(specs[1], streamOpts);
  const slot2 = useSourceStream(specs[2], streamOpts);
  const slot3 = useSourceStream(specs[3], streamOpts);
  const slot4 = useSourceStream(specs[4], streamOpts);

  const streams = useMemo(
    () =>
      [slot0, slot1, slot2, slot3, slot4].filter(
        (s): s is SourceStream & { spec: MultiSourceStreamSpec } =>
          s.spec != null,
      ),
    [slot0, slot1, slot2, slot3, slot4],
  );

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
        isActive: !stream.isError,
        dateRange: stream.spec.config.dateRange,
      })),
    [streams],
  );

  const merged = useMemo(
    () => mergeStreams(snapshots, 'DESC', MULTI_SOURCE_ALIASES.timestamp),
    [snapshots],
  );

  // Merge column meta across streams by canonical alias name, preferring a
  // resolved type over the Nullable(Nothing) a `NULL AS "alias"` projection
  // reports.
  const columnTypeMap = useMemo(() => {
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
  }, [streams]);

  const includeDuration = specs.some(s => s.source.kind === SourceKind.Trace);

  const displayedColumns = useMemo(
    () => [
      MULTI_SOURCE_ALIASES.timestamp,
      MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME,
      MULTI_SOURCE_ALIASES.service,
      MULTI_SOURCE_ALIASES.severity,
      ...(includeDuration ? [MULTI_SOURCE_ALIASES.durationMs] : []),
      ...extraColumnNames,
      MULTI_SOURCE_ALIASES.body,
    ],
    [includeDuration, extraColumnNames],
  );

  // Stringify object-typed cells (Map/Array/JSON) the same way DBSqlRowTable
  // does — both for display and because useRowWhere expects the stringified
  // form when rebuilding a row WHERE clause.
  const rows = useMemo(() => {
    const objectColumns = [...columnTypeMap.entries()]
      .filter(([, v]) => isJSDataTypeJSONStringifiable(v._type))
      .map(([name]) => name);
    if (objectColumns.length === 0) {
      return merged.rows;
    }
    return merged.rows.map(row => {
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
  }, [merged.rows, columnTypeMap]);

  // Row identity dispatches to the row's own stream: each stream has its own
  // result meta / alias map / primary-key columns. The client-side tag fields
  // are stripped first — they aren't real columns.
  const generateRowId = useCallback(
    (row: Record<string, any>): RowWhereResult => {
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
    [streams],
  );

  // Advance only the stream(s) holding the frontier back; the leaders keep
  // their fetched-but-held rows until the laggards catch up.
  const fetchNextPage = useCallback(() => {
    for (const sourceId of merged.laggingSourceIds) {
      const stream = streams.find(s => s.spec.source.id === sourceId);
      stream?.fetchNextPage({ cancelRefetch: false });
    }
  }, [merged.laggingSourceIds, streams]);

  const hasNextPage = streams.some(s => !s.isError && s.hasNextPage);
  const isFetching = streams.some(s => s.isFetching);
  const allFailed = streams.length > 0 && streams.every(s => s.isError);
  const firstError = streams.find(s => s.error != null)?.error ?? undefined;

  // Side panel wiring — the same URL-param contract as
  // DBSqlRowTableWithSideBar, except the panel's source comes from the
  // clicked row rather than the (single) searched source.
  const [rowId, setRowId] = useQueryState('rowWhere', parseAsStringEncoded);
  const [rowSource, setRowSource] = useQueryState('rowSource');
  const [aliasWith, setAliasWith] = useState<WithClause[]>([]);

  const onRowDetailsClick = useCallback(
    (row: Record<string, any>) => {
      const rowWhere = generateRowId(row);
      if (!rowWhere.where) return;
      setRowId(rowWhere.where);
      setAliasWith(rowWhere.aliasWith);
      setRowSource(row[MULTI_SOURCE_ROW_FIELDS.SOURCE_ID] ?? null);
      onSidebarOpen?.(rowWhere.where);
    },
    [generateRowId, setRowId, setRowSource, onSidebarOpen],
  );

  const onCloseSidebar = useCallback(() => {
    setRowId(null);
    setRowSource(null);
  }, [setRowId, setRowSource]);

  const panelSource = useMemo(
    () => specs.find(s => s.source.id === rowSource)?.source,
    [specs, rowSource],
  );

  const renderRowDetails = useCallback(
    (r: { id: string; aliasWith?: WithClause[]; [key: string]: unknown }) => {
      const source = specs.find(
        s => s.source.id === r[MULTI_SOURCE_ROW_FIELDS.SOURCE_ID],
      )?.source;
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
    [specs],
  );

  const loadingDate =
    merged.frontier != null && hasNextPage
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
        <StreamStatusChips streams={streams} />
        {allFailed ? (
          <ChartErrorState error={firstError ?? new Error('Search failed')} />
        ) : (
          <RawLogTable
            isLive={isLive}
            wrapLines={false}
            displayedColumns={displayedColumns}
            columnNameMap={COLUMN_NAME_MAP}
            highlightedLineId={rowId ?? undefined}
            rows={rows}
            isLoading={isFetching}
            fetchNextPage={fetchNextPage}
            hasNextPage={hasNextPage}
            onRowDetailsClick={onRowDetailsClick}
            generateRowId={generateRowId}
            onScroll={onScroll}
            columnTypeMap={columnTypeMap}
            dateRange={firstConfig?.dateRange}
            loadingDate={loadingDate}
            config={firstConfig}
            renderRowDetails={renderRowDetails}
            onExpandedRowsChange={onExpandedRowsChange}
            collapseAllRows={collapseAllRows}
            enableSorting={false}
            getRowWhere={generateRowId}
            tableId={tableId}
          />
        )}
      </Flex>
    </RowSidePanelContext>
  );
}
