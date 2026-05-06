import type { GlueTableSchema } from '@berg/common-utils/dist/glue/types';
import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

/**
 * Fetches the full schema for a single Glue table. Unlike the browse
 * endpoints, the underlying API surfaces `AccessDenied` and `EntityNotFound`
 * as real HTTP errors so the UI can distinguish "no such table" from
 * "hidden by IAM" rather than just rendering a blank schema.
 */
export function useTableSchema(
  catalogId: string | undefined,
  database: string | undefined,
  table: string | undefined,
) {
  return useQuery<GlueTableSchema>({
    queryKey: ['catalog', 'schema', catalogId, database, table],
    enabled: !!catalogId && !!database && !!table,
    queryFn: () =>
      hdxServer(
        `v1/catalogs/${encodeURIComponent(catalogId!)}/databases/${encodeURIComponent(database!)}/tables/${encodeURIComponent(table!)}/schema`,
      ).json<GlueTableSchema>(),
  });
}
