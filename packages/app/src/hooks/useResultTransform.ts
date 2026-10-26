import {
  type ColumnMetaType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { SERIES_KEY_JOINER } from '@hyperdx/common-utils/dist/core/seriesNameTemplate';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartConfigWithOptDateRange,
  ChartVariable,
} from '@hyperdx/common-utils/dist/types';
import { substituteVariables } from '@hyperdx/common-utils/dist/variables';
import { useQuery } from '@tanstack/react-query';

import { inferGroupColumns } from '@/ChartUtils';
import {
  chdbFileTable,
  getChdb,
  IS_CHDB_AVAILABLE,
  queryChdbRows,
  quoteIdentifier,
} from '@/chdb';
import { BASE_PATH } from '@/config';

/** Stands for each value in a tile's transform and filter, as in `$res * 2`. */
export const VALUE_PLACEHOLDER = '$res';

/** Stands for a value's series name in a tile's filter, as in `$name != 'api'`. */
export const SERIES_NAME_PLACEHOLDER = '$name';

type ResultTransformConfig = Pick<
  ChartConfigWithOptDateRange,
  'transformSql' | 'filterSql' | 'variables'
>;

/**
 * SQL that applies the transform to every value (numeric) column of the result
 * in `table`, then keeps the rows where the filter holds for any of them.
 * Columns keep their names, so the chart reads the result as before.
 */
function buildResultSql({
  transform,
  filter,
  meta,
  table,
  variables,
}: {
  transform: string | undefined;
  filter: string | undefined;
  meta: ColumnMetaType[];
  table: string;
  variables: ChartVariable[];
}) {
  const values =
    filterColumnMetaByType(meta, [JSDataType.Number])?.map(c => c.name) ?? [];
  const groups = inferGroupColumns(meta)?.map(c => c.name) ?? [];
  const substitute = (sql: string) =>
    substituteVariables(sql, { variables, inputLanguage: 'sql' });

  // Named like the chart's series: the group values, led by the value column
  // when there are several (see formatResponseForTimeChart)
  const seriesName = (value: string) => {
    const parts = [
      ...(values.length > 1 || groups.length === 0
        ? [`'${escapeSqlString(value)}'`]
        : []),
      ...groups.map(group => `toString(${quoteIdentifier(group)})`),
    ];
    return parts.length === 1
      ? parts[0]
      : `concatWithSeparator('${escapeSqlString(SERIES_KEY_JOINER)}', ${parts.join(', ')})`;
  };
  const expand = (template: string, value: string) =>
    substitute(
      template
        .replace(/\$res\b/g, () => quoteIdentifier(value))
        .replace(/\$name\b/g, () => seriesName(value)),
    );

  const columns = meta.map(({ name }) =>
    transform && values.includes(name)
      ? `(${expand(transform, name)}) AS ${quoteIdentifier(name)}`
      : quoteIdentifier(name),
  );
  const select = `SELECT ${columns.join(', ')} FROM ${table}`;
  if (!filter) return select;

  const conditions =
    values.length > 0
      ? [...new Set(values.map(value => `(${expand(filter, value)})`))]
      : [`(${substitute(filter)})`];
  return `SELECT * FROM (${select}) WHERE ${conditions.join(' OR ')}`;
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
  config: ResultTransformConfig,
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

const useResultTransformInBrowser: UseResultTransform = (query, config) => {
  const transform = config.transformSql?.trim() || undefined;
  const filter = config.filterSql?.trim() || undefined;
  const result = query.data;

  const transformed = useQuery({
    queryKey: [
      'chdb-result-transform',
      transform,
      filter,
      config.variables,
      result ? getResultId(result) : undefined,
    ],
    queryFn: async () => {
      const meta = result?.meta;
      if (!result || !meta) {
        throw new Error('There is no query result to transform');
      }
      const db = await getChdb(BASE_PATH);
      const response = await queryChdbRows(db, result.data, file =>
        buildResultSql({
          transform,
          filter,
          meta,
          table: chdbFileTable(file, meta),
          variables: config.variables ?? [],
        }),
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
    enabled:
      (transform != null || filter != null) &&
      result?.meta != null &&
      !query.isPlaceholderData,
    placeholderData: prev => prev,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (transform == null && filter == null) return query;
  return {
    ...query,
    data: transformed.data,
    isLoading:
      query.isLoading ||
      (result != null && transformed.data == null && !transformed.isError),
    isError: query.isError || transformed.isError,
    error: query.error ?? transformed.error,
  };
};

const passThrough: UseResultTransform = query => query;

/**
 * Applies the tile's transform and filter to a chart's query result in chdb,
 * returning the query state with the new result in its place.
 */
export const useResultTransform: UseResultTransform = IS_CHDB_AVAILABLE
  ? useResultTransformInBrowser
  : passThrough;
