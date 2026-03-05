import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { Row, SortingFnOption } from '@tanstack/react-table';

export const numericRowSortingFn = ((
  a: Row<unknown>,
  b: Row<unknown>,
  columnId: string,
) => {
  const aValue = a.getValue(columnId);
  const bValue = b.getValue(columnId);

  const aInvalid = aValue == null || isNaN(Number(aValue));
  const bInvalid = bValue == null || isNaN(Number(bValue));
  if (aInvalid && bInvalid) return 0;
  if (aInvalid) return 1;
  if (bInvalid) return -1;

  return Number(aValue) - Number(bValue);
}) satisfies SortingFnOption<unknown>;

export const getClientSideSortingFn = (
  meta: ColumnMetaType[] | undefined,
  columnName: string,
): SortingFnOption<unknown> => {
  const columnMeta = meta?.find(col => col.name === columnName);
  const jsType = columnMeta
    ? convertCHDataTypeToJSType(columnMeta.type)
    : undefined;

  if (jsType === 'number') {
    return numericRowSortingFn;
  }

  // Fallback to alphanumeric sorting for other types, including when metadata is unavailable, and when
  // metadata indicates that the column type is date (in which case the value will be a string type in JS)
  return 'alphanumeric';
};
