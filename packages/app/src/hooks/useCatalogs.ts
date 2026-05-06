import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

interface CatalogsResponse {
  catalogs: string[];
}

/**
 * Lists Glue Data Catalog identifiers visible to the requesting user's IAM
 * role. Returns simple strings — `AwsDataCatalog` for the default account
 * catalog and `s3tablescatalog/<bucket>` for federated S3 Tables catalogs.
 */
export function useCatalogs() {
  return useQuery({
    queryKey: ['catalog', 'catalogs'],
    queryFn: () =>
      hdxServer('v1/catalogs')
        .json<CatalogsResponse>()
        .then(r => r.catalogs),
  });
}
