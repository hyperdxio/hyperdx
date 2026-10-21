import { useMemo } from 'react';
import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  isJSDataTypeScalar,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  TableConnection,
} from '@hyperdx/common-utils/dist/core/metadata';

import { toQuotedClickHouseKeyExpression } from '@/components/DBSearchPageFilters/utils';
import { useAllFields } from '@/hooks/useMetadata';
import { mergePath } from '@/utils';

function namesOfType(columns: ColumnMeta[], types: JSDataType[]) {
  return (
    filterColumnMetaByType(columns, types)?.map(column => column.name) ?? []
  );
}

// Ad hoc filters drop DateTime because their comparisons are stringly. A
// column or sort field is a SQL expression, so Timestamp stays selectable.
function clauseFieldKeys(fields: Field[], columns: ColumnMeta[]) {
  const jsonColumns = namesOfType(columns, [JSDataType.JSON]);
  const mapColumns = namesOfType(columns, [JSDataType.Map]);
  return fields
    .filter(field => field.path.length > 1 || isJSDataTypeScalar(field.jsType))
    .map(field => mergePath(field.path, jsonColumns, mapColumns));
}

function clauseColumnKeys(columns: ColumnMeta[]) {
  return columns
    .filter(column =>
      isJSDataTypeScalar(convertCHDataTypeToJSType(column.type)),
    )
    .map(column => column.name);
}

/** The source's fields as SQL expressions, for the Pick tabs. */
export function useClauseFieldOptions({
  tableConnection,
  columns,
  dateRange,
  timestampValueExpression,
}: {
  tableConnection: TableConnection | undefined;
  columns: ColumnMeta[] | undefined;
  dateRange?: [Date, Date];
  timestampValueExpression?: string;
}): string[] {
  const { data: fields, isFieldMetadataDisabled } = useAllFields(
    tableConnection,
    {
      dateRange,
      timestampValueExpression,
    },
  );

  return useMemo(() => {
    if (columns == null) return [];
    const knownColumns = new Set(columns.map(column => column.name));
    // Field discovery is off for some teams, and `useAllFields` then returns
    // [] rather than "still loading". Scalar columns are still known.
    const keys =
      isFieldMetadataDisabled || fields == null
        ? clauseColumnKeys(columns)
        : clauseFieldKeys(fields, columns);
    return Array.from(
      new Set(
        keys.map(key => toQuotedClickHouseKeyExpression(key, knownColumns)),
      ),
    ).sort();
  }, [fields, columns, isFieldMetadataDisabled]);
}
