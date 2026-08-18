import { Filter } from '@hyperdx/common-utils/dist/types';

type AppliedConfigParams = {
  source?: string | null;
  service?: string | null;
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
};

export type AppliedConfig = AppliedConfigParams & {
  additionalFilters?: Filter[];
};
