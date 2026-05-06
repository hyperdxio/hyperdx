import type { GlueTableSummary } from '@berg/common-utils/dist/glue/types';
import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

interface TablesResponse {
  tables: GlueTableSummary[];
}

/**
 * Lists tables in the given catalog/database with format detection (iceberg
 * / parquet / orc / csv) so the UI can render the right icon without an
 * extra round trip per row. Disabled when database is not selected.
 */
export function useTables(
  catalogId: string | undefined,
  database: string | undefined,
) {
  return useQuery({
    queryKey: ['catalog', 'tables', catalogId, database],
    enabled: !!catalogId && !!database,
    queryFn: () =>
      hdxServer(
        `v1/catalogs/${encodeURIComponent(catalogId!)}/databases/${encodeURIComponent(database!)}/tables`,
      )
        .json<TablesResponse>()
        .then(r => r.tables),
  });
}
