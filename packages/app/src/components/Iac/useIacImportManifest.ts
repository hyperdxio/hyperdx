import { ZodError } from 'zod';
import { IacImportManifestSchema } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

export function useIacImportManifest() {
  return useQuery({
    queryKey: ['iac', 'import-manifest'],
    queryFn: async () => {
      const body = await hdxServer('iac/import-manifest').json();
      // Parsed, not cast. The generated Terraform is only as trustworthy as
      // this payload, and a type assertion would let server drift through
      // silently — `provisioned` arriving as a string, say, would then decide
      // whether a connection is emitted as an importable resource.
      return IacImportManifestSchema.parse(body);
    },
    // Six unbounded team-scoped finds per call; without this the manifest is
    // instantly stale and refetches every time the tab regains visibility.
    staleTime: 60_000,
    // A schema violation is deterministic — the app-wide default of three
    // retries would re-issue that six-query fan-out four times before the
    // error banner ever rendered. Transport failures are still worth one
    // retry, so only the parse is excluded.
    retry: (failureCount, error) =>
      !(error instanceof ZodError) && failureCount < 1,
  });
}
