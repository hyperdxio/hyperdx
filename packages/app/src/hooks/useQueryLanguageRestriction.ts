import type { WhereLanguage } from '@hyperdx/common-utils/dist/types';

import api from '@/api';

/**
 * The team-wide WHERE language lock, or undefined when users may pick either.
 * Local mode has no team, so it never restricts.
 */
export function useQueryLanguageRestriction(): WhereLanguage | undefined {
  const { data: me } = api.useMe();
  return me?.team.queryLanguageRestriction;
}
