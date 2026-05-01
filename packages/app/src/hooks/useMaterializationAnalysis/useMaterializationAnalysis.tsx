import { useEffect, useMemo, useRef, useState } from 'react';
import SqlString from 'sqlstring';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { NOW } from '@/config';
import {
  canonicalizeRefs,
  type MapKeyExtractionResult,
  type MapKeyReference,
  MapReferenceExtractor,
  MapReferenceGroup,
  mapReferenceToKey,
  type ParseRequest,
  type ParseResponse,
} from '@/hooks/useMaterializationAnalysis/useMaterializationAnalysis.shared';
import { useColumns, useTableMetadata } from '@/hooks/useMetadata';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';

// We'll search up to the last 30 days of query history
const SEARCH_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;

type QueryLogRow = {
  query?: unknown;
  query_duration_ms?: unknown;
};

type AggregateState = {
  referencesByColumn: Map<string, MapReferenceGroup>;
  queriesParsed: number;
  queriesFailedToParse: number;
  queriesWithKeys: number;
};

const INITIAL_AGGREGATE: AggregateState = {
  referencesByColumn: new Map(),
  queriesParsed: 0,
  queriesFailedToParse: 0,
  queriesWithKeys: 0,
};

// Combine an existing combo with a fresh contribution covering the same
// canonical key set. When `existing` is undefined, the fresh combo *is* the
// merged result. The caller is responsible for storing the returned value.
function mergeCombos(
  existing: MapReferenceGroup | undefined,
  fresh: MapReferenceGroup,
): MapReferenceGroup {
  if (!existing) return fresh;
  return {
    refs: existing.refs,
    queryCount: existing.queryCount + fresh.queryCount,
    sumDurationMs: existing.sumDurationMs + fresh.sumDurationMs,
  };
}

// Fold a worker batch into the running Stage 1 aggregate state. `durations`
// is paired 1:1 with `results` (captured at dispatch time so we don't need
// the rows array anymore).
function foldBatch(
  acc: AggregateState,
  results: MapKeyExtractionResult[],
  durations: number[],
): AggregateState {
  const accumulatedRefsByColumn = new Map(acc.referencesByColumn);
  let parsed = acc.queriesParsed;
  let failed = acc.queriesFailedToParse;
  let withKeys = acc.queriesWithKeys;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.ok) {
      parsed += 1;
    } else {
      failed += 1;
      continue;
    }

    if (result.keys.length === 0) continue;
    withKeys += 1;

    const dur = durations[i] ?? 0;

    // Bucket the query's references by source map column so each combo only
    // contains keys from a single column.
    const refsByColumn = new Map<string, MapKeyReference[]>();
    for (const ref of result.keys) {
      const arr = refsByColumn.get(ref.column);
      if (arr) {
        arr.push(ref);
      } else {
        refsByColumn.set(ref.column, [ref]);
      }
    }

    // Update accumulatedRefsByColumn with the new values from this query
    for (const refs of refsByColumn.values()) {
      const { sig, refs: canonicalRefs } = canonicalizeRefs(refs);
      accumulatedRefsByColumn.set(
        sig,
        mergeCombos(accumulatedRefsByColumn.get(sig), {
          refs: canonicalRefs,
          queryCount: 1,
          sumDurationMs: dur,
        }),
      );
    }
  }

  return {
    referencesByColumn: accumulatedRefsByColumn,
    queriesParsed: parsed,
    queriesFailedToParse: failed,
    queriesWithKeys: withKeys,
  };
}

// Stage 2: derive the displayed combos from Stage 1 + the current materialized columns state.
// For each Stage 1 combo, drop any keys that are now
// materialized; if anything's left, key by the new signature so combos
// that collide post-filter are merged.
function deriveDisplayCombos(
  rawCombos: Map<string, MapReferenceGroup>,
  alreadyMaterialized: Set<string>,
): MapReferenceGroup[] {
  const merged = new Map<string, MapReferenceGroup>();
  for (const combo of rawCombos.values()) {
    const remaining = combo.refs.filter(
      r => !alreadyMaterialized.has(mapReferenceToKey(r)),
    );
    if (remaining.length === 0) continue;
    const { sig, refs: canonicalRefs } = canonicalizeRefs(remaining);
    merged.set(
      sig,
      mergeCombos(merged.get(sig), {
        refs: canonicalRefs,
        queryCount: combo.queryCount,
        sumDurationMs: combo.sumDurationMs,
      }),
    );
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (b.queryCount !== a.queryCount) return b.queryCount - a.queryCount;
    return b.sumDurationMs - a.sumDurationMs;
  });
}

function useMapMaterializationMetadata(source: TSource | undefined) {
  const { data: tableMeta, isLoading: isLoadingTableMeta } = useTableMetadata(
    {
      databaseName: source?.from.databaseName ?? '',
      tableName: source?.from.tableName ?? '',
      connectionId: source?.connection ?? '',
    },
    { enabled: !!source },
  );

  const { data: columnMeta, isLoading: isLoadingColumnMeta } = useColumns(
    {
      databaseName: source?.from.databaseName ?? '',
      tableName: source?.from.tableName ?? '',
      connectionId: source?.connection ?? '',
    },
    { enabled: !!source },
  );

  const mapColumns = useMemo(() => {
    const mapColumns =
      filterColumnMetaByType(columnMeta ?? [], [JSDataType.Map])
        ?.filter(c => c.type.startsWith('Map'))
        .map(c => c.name) ?? [];

    if (!mapColumns.length) {
      console.error('No map columns found', columnMeta);
    }

    return mapColumns;
  }, [columnMeta]);

  const parser = useMemo(() => {
    return new MapReferenceExtractor(mapColumns);
  }, [mapColumns]);

  const materializedReferences = useMemo<MapKeyReference[]>(
    () =>
      tableMeta && parser
        ? parser.extractMaterializedReferencesFromDDL(
            tableMeta.create_table_query,
          )
        : [],
    [parser, tableMeta],
  );

  const materializedKeys = useMemo(
    () => new Set(materializedReferences.map(mapReferenceToKey)),
    [materializedReferences],
  );

  return {
    mapColumns,
    materializedReferences,
    materializedKeys,
    isLoading: isLoadingColumnMeta || isLoadingTableMeta,
  };
}

export function useMaterializationAnalysis({
  source,
  enabled,
}: {
  source: TSource | undefined;
  enabled: boolean;
}) {
  const { id: sourceId, connection, from } = source ?? {};
  const sourceDatabase = from?.databaseName;
  const sourceTable = from?.tableName;

  const {
    mapColumns,
    materializedKeys,
    materializedReferences,
    isLoading: isLoadingMetadata,
  } = useMapMaterializationMetadata(source);

  const dateRange = useMemo<[Date, Date]>(() => {
    const end = new Date(NOW);
    const start = new Date(NOW - SEARCH_DURATION_MS);
    return [start, end];
  }, []);

  // The chart config for searching the query_log system table for relevant queries
  const queryLogConfig = useMemo(() => {
    const qualifiedTable = `${sourceDatabase}.${sourceTable}`; // TODO test escaping edge cases
    const searchValues = mapColumns
      .map(column => SqlString.escape(column))
      .join(', ');

    return {
      connection: connection ?? '',
      from: { databaseName: 'system', tableName: 'query_log' },
      timestampValueExpression: 'event_time',
      select: 'query, query_duration_ms',
      where:
        `type = 'QueryFinish' ` +
        `AND query_kind = 'Select' ` +
        `AND has(tables, '${qualifiedTable}') ` +
        `AND multiSearchAny(query, [${searchValues}])`,
      whereLanguage: 'sql' as const,
      orderBy: 'event_time DESC',
      limit: { limit: PAGE_SIZE },
      dateRange,
    };
  }, [connection, sourceDatabase, sourceTable, mapColumns, dateRange]);

  // Use windowed pagination to fetch the query log in batches, starting from
  // the most recent queries and working backwards.
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
    isError,
    error,
  } = useOffsetPaginatedQuery(queryLogConfig, {
    enabled: !!sourceId && enabled,
    queryKeyPrefix: 'materializationAnalysis',
  });

  // Continuously fetch new pages until we've exhausted the query_log or the search is disabled.
  const isFinished = !hasNextPage || isError;
  useEffect(() => {
    if (enabled && !!source && !isFinished && !isFetching) {
      fetchNextPage();
    }
  }, [enabled, source, isFetching, fetchNextPage, isFinished]);

  const rows = useMemo(() => (data?.data ?? []) as QueryLogRow[], [data?.data]);

  // Worker-driven parsing: spawn one worker per hook instance, dispatch new
  // rows in batches as they arrive, and fold each batch's results into
  // running aggregate state on the way back. We never retain per-row parse
  // results — the rows-in-flight are released for GC as soon as the worker
  // response is folded.
  //
  // A session counter increments on source change so stale responses from a
  // prior source can be discarded.
  const workerRef = useRef<Worker | null>(null);
  const sessionRef = useRef(0);
  const sentCountRef = useRef(0);
  const batchIdRef = useRef(0);
  const sessionByBatchRef = useRef<Map<number, number> | null>(null);

  // Per-batch durations captured at dispatch time, paired 1:1 with the SQLs
  // sent to the worker. Looked up on response so the fold can attribute each
  // parsed result to the right query_duration_ms without keeping the rows.
  const batchDurationsRef = useRef<Map<number, number[]> | null>(null);

  const [aggState, setAggState] = useState<AggregateState>(INITIAL_AGGREGATE);

  // Setup a web worker to parse batches of queries. Each response folds the
  // results into Stage 1 and is then immediately discarded. Stage 1 is the
  // raw observed key-set co-occurrence — the fold here intentionally does
  // not consult the materialized set, so applying or unapplying an ALTER
  // never invalidates this state.
  useEffect(() => {
    const worker = new Worker(
      new URL('./useMaterializationAnalysis.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    // Maps batchId to the "session" when it was dispatched to the worker. This allows for
    // discarding worker responses that come from a prior source selection.
    const sessionByBatch = new Map<number, number>();
    sessionByBatchRef.current = sessionByBatch;
    const batchDurations = new Map<number, number[]>();
    batchDurationsRef.current = batchDurations;

    const handleWorkerMessage = ({
      data: { batchId, results },
    }: MessageEvent<ParseResponse>) => {
      const batchSession = sessionByBatch.get(batchId);
      sessionByBatch.delete(batchId);
      const durations = batchDurations.get(batchId) ?? [];
      batchDurations.delete(batchId);
      // Discard responses from a prior source selection.
      if (batchSession !== sessionRef.current) return;

      setAggState(prev => foldBatch(prev, results, durations));
    };
    worker.addEventListener('message', handleWorkerMessage);

    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
      workerRef.current = null;
      sessionByBatchRef.current = null;
      batchDurationsRef.current = null;
    };
  }, []);

  // Reset aggregate state whenever the source changes — new session, new history.
  useEffect(() => {
    sessionRef.current += 1;
    sentCountRef.current = 0;
    batchDurationsRef.current?.clear();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAggState(INITIAL_AGGREGATE);
  }, [sourceId]);

  // When new rows arrive, ship the unparsed tail to the worker along with
  // its durations so the response can be folded without retaining rows.
  useEffect(() => {
    const worker = workerRef.current;
    const sessionByBatch = sessionByBatchRef.current;
    const batchDurations = batchDurationsRef.current;
    if (!worker || !sessionByBatch || !batchDurations) return;
    if (rows.length <= sentCountRef.current) return;

    const startIndex = sentCountRef.current;
    const newRows = rows.slice(startIndex);
    sentCountRef.current = rows.length;

    // Filter to rows with a usable string query, capturing durations in
    // lockstep so the response array aligns 1:1 with these durations.
    const sqls: string[] = [];
    const durations: number[] = [];
    for (const row of newRows) {
      if (typeof row.query !== 'string') continue;
      sqls.push(row.query);
      const d = Number(row.query_duration_ms);
      durations.push(Number.isFinite(d) ? d : 0);
    }
    if (sqls.length === 0) return;

    const batchId = batchIdRef.current++;
    sessionByBatch.set(batchId, sessionRef.current);
    batchDurations.set(batchId, durations);

    worker.postMessage({
      batchId,
      startIndex,
      sqls,
      columns: mapColumns,
    } satisfies ParseRequest);
  }, [mapColumns, rows]);

  // Stage 2: derive the displayed combos from the raw Stage 1 corpus and the
  // current materialized set. Cheap to recompute and re-runs only when one
  // of those two inputs changes (page fold, or apply).
  const displayCombos = useMemo(
    () => deriveDisplayCombos(aggState.referencesByColumn, materializedKeys),
    [aggState.referencesByColumn, materializedKeys],
  );

  return {
    combos: displayCombos,
    queriesFetched: rows.length,
    queriesParsed: aggState.queriesParsed,
    queriesFailedToParse: aggState.queriesFailedToParse,
    queriesWithKeys: aggState.queriesWithKeys,
    materializedReferences,
    searchedBackTo: data?.window?.startTime ?? null,
    hasNextPage,
    isFetching,
    isLoading: isLoading || isLoadingMetadata,
    error,
    isDDLLoaded: !isLoadingMetadata,
  };
}

// Build the ALTER TABLE … ADD COLUMN … MATERIALIZED statements for every key
// in a combo. Returns a list (currently always one statement) so callers can
// execute each independently against ClickHouse.
export function buildAlterTableStatements(
  source: TSource,
  combo: MapReferenceGroup,
): string[] {
  const fq = `${source.from.databaseName}.${source.from.tableName}`;
  const adds = combo.refs.map(({ column, key }) => {
    const safeKey = key.replace(/[^A-Za-z0-9_]/g, '_');
    const colName = `__hdx_materialized_${safeKey}`;
    const escapedKey = key.replace(/'/g, "\\'");
    return `  ADD COLUMN \`${colName}\` String MATERIALIZED ${column}['${escapedKey}']`;
  });
  return [`ALTER TABLE ${fq}\n${adds.join(',\n')}`];
}
