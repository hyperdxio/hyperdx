import { useCallback, useMemo } from 'react';
import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { useJsonColumns } from './useMetadata';

export type FieldExpressionGenerator = (
  /** The column name, either a Map or a JSON column */
  column: string,
  /** The map key or JSON path to access */
  key: string,
  /** Function to convert a Dynamic field from JSON to a non-Dynamic type. Defaults to toString */
  convertFn?: string,
) => string;

/** Utility for rendering SQL field access expressions for Maps and JSON types. */
export default function useFieldExpressionGenerator(
  source: TSource | undefined,
): {
  isLoading: boolean;
  getFieldExpression: FieldExpressionGenerator | undefined;
} {
  const { data: jsonColumns, isLoading: isLoadingJsonColumns } = useJsonColumns(
    tcFromSource(source),
  );

  // Memoize the generator so it has a stable reference across renders when
  // its inputs haven't changed. Several call sites pass the returned function
  // into `useMemo` / `useEffect` dependency arrays, and a fresh closure on
  // every render previously caused expensive recomputation cascades that
  // amplified render-loop bugs when the underlying schema query failed.
  const getFieldExpression = useCallback<FieldExpressionGenerator>(
    (column, key, convertFn = 'toString') => {
      const isJson = jsonColumns?.includes(column);
      return isJson
        ? SqlString.format(`${convertFn}(??.??)`, [column, key])
        : SqlString.format('??[?]', [column, key]);
    },
    [jsonColumns],
  );

  return useMemo(
    () =>
      source && !isLoadingJsonColumns
        ? { isLoading: false, getFieldExpression }
        : { isLoading: isLoadingJsonColumns, getFieldExpression: undefined },
    [source, isLoadingJsonColumns, getFieldExpression],
  );
}
