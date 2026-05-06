import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

interface DatabasesResponse {
  databases: string[];
}

/**
 * Lists databases / namespaces visible to the requesting role under the
 * given Glue catalog. Disabled when no catalog is selected so React Query
 * doesn't fire a request for an undefined route segment.
 */
export function useDatabases(catalogId: string | undefined) {
  return useQuery({
    queryKey: ['catalog', 'databases', catalogId],
    enabled: !!catalogId,
    queryFn: () =>
      hdxServer(`v1/catalogs/${encodeURIComponent(catalogId!)}/databases`)
        .json<DatabasesResponse>()
        .then(r => r.databases),
  });
}
