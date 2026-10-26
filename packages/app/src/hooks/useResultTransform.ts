import {
  type ColumnMetaType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { useQuery } from '@tanstack/react-query';

import {
  chdbFileTable,
  getChdb,
  IS_CHDB_AVAILABLE,
  queryChdbRows,
  quoteIdentifier,
} from '@/chdb';
import { BASE_PATH } from '@/config';

/** Stands for each value in a tile's transform, as in `$res * 2`. */
export const TRANSFORM_VALUE_PLACEHOLDER = '$res';

/**
 * SQL applying the transform to every numeric (value) column of the result in
 * `table`. Other columns pass through, and every column keeps its name, so the
 * chart reads the result exactly as before.
 */
function buildTransformSql(
  transform: string,
  meta: ColumnMetaType[],
  table: string,
) {
  const values = new Set(
    filterColumnMetaByType(meta, [JSDataType.Number])?.map(({ name }) => name),
  );
  const columns = meta.map(({ name }) => {
    const column = quoteIdentifier(name);
    return values.has(name)
      ? `(${transform.replace(/\$res\b/g, () => column)}) AS ${column}`
      : column;
  });
  return `SELECT ${columns.join(', ')} FROM ${table}`;
}

type TransformableResult = {
  data: Record<string, unknown>[];
  meta?: ColumnMetaType[];
};

type ResultQuery<R> = {
  data: R | null | undefined;
  isPlaceholderData?: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

type UseResultTransform = <
  R extends TransformableResult,
  Q extends ResultQuery<R>,
>(
  query: Q,
  transformSql: string | undefined,
) => Q;

// Query keys must serialize, so each result object is keyed by a number.
const resultIds = new WeakMap<object, number>();
let lastResultId = 0;
function getResultId(result: object) {
  let id = resultIds.get(result);
  if (id == null) {
    id = ++lastResultId;
    resultIds.set(result, id);
  }
  return id;
}

const useResultTransformInBrowser: UseResultTransform = (
  query,
  transformSql,
) => {
  const sql = transformSql?.trim();
  const result = query.data;

  const transform = useQuery({
    queryKey: [
      'chdb-result-transform',
      sql,
      result ? getResultId(result) : undefined,
    ],
    queryFn: async () => {
      const meta = result?.meta;
      if (!sql || !result || !meta) {
        throw new Error('There is no query result to transform');
      }
      const db = await getChdb(BASE_PATH);
      const response = await queryChdbRows(db, result.data, file =>
        buildTransformSql(sql, meta, chdbFileTable(file, meta)),
      );
      return {
        ...result,
        data: response.data,
        meta: response.meta,
        rows: response.rows,
      };
    },
    // A placeholder is the previous query's result; keep showing the previous
    // transform until the current result arrives.
    enabled: !!sql && result?.meta != null && !query.isPlaceholderData,
    placeholderData: prev => prev,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!sql) return query;
  return {
    ...query,
    data: transform.data,
    isLoading:
      query.isLoading ||
      (result != null && transform.data == null && !transform.isError),
    isError: query.isError || transform.isError,
    error: query.error ?? transform.error,
  };
};

const passThrough: UseResultTransform = query => query;

/**
 * Applies the tile's transform to a chart's query result in chdb, returning
 * the query state with the transformed result in its place.
 */
export const useResultTransform: UseResultTransform = IS_CHDB_AVAILABLE
  ? useResultTransformInBrowser
  : passThrough;
