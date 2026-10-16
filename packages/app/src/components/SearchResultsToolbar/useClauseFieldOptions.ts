import { useMemo } from 'react';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';

import {
  getSqlSourceColumnKeys,
  getSqlSourceKeys,
} from '@/components/AdhocDashboardFilter/useAdhocFilterOptions';
import { useAllFields } from '@/hooks/useMetadata';

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
  const { data: fields } = useAllFields(tableConnection, {
    dateRange,
    timestampValueExpression,
  });

  return useMemo(() => {
    if (columns == null) return [];
    const keys =
      fields != null
        ? getSqlSourceKeys(fields, columns)
        : getSqlSourceColumnKeys(columns);
    return Array.from(new Set(keys)).sort();
  }, [fields, columns]);
}
