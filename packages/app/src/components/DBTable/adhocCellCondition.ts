import {
  isJSDataTypeScalar,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { quoteResultColumnNameIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';
import { isAdhocComparableDataType } from '@hyperdx/common-utils/dist/filters';

type ColumnType = { _type: JSDataType | null; type?: string };

// The table renders Dynamic values as JSON text, e.g. `"api"` for api.
function parseDynamicScalar(cellValue: unknown): string | undefined {
  if (typeof cellValue !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(cellValue);
    return parsed != null && typeof parsed !== 'object'
      ? String(parsed)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `key = value` that clicking a search tile cell adds to an ad hoc filter,
 * which compares the value with `toString(key)`. Undefined when the cell can't
 * match that: structured values, which the table renders as JSON, and
 * DateTimes, which it renders as ISO UTC rather than in the column's timezone.
 */
export function getAdhocCellCondition(
  column: string,
  columnType: ColumnType | undefined,
  cellValue: unknown,
  aliasMap: Record<string, string> | undefined,
): { key: string; value: string } | undefined {
  const jsType = columnType?._type ?? null;
  if (
    cellValue == null ||
    !isJSDataTypeScalar(jsType) ||
    !isAdhocComparableDataType(columnType?.type ?? '')
  ) {
    return undefined;
  }
  const value =
    jsType === JSDataType.Dynamic
      ? parseDynamicScalar(cellValue)
      : String(cellValue);
  if (value == null) return undefined;
  return {
    key: aliasMap?.[column] ?? quoteResultColumnNameIfNeeded(column),
    value,
  };
}
