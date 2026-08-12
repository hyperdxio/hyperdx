import { useMemo } from 'react';

import { IS_DASHBOARD_VARIABLES_ENABLED } from '@/config';

/**
 * Whether dashboard filter values may be exposed to tile queries as
 * `$variableName`. Exposed as a hook with loading state to support team-level
 * toggle loading in the future.
 */
export function useIsVariablesEnabled() {
  return useMemo(
    () => ({
      isLoading: false,
      isVariablesEnabled: IS_DASHBOARD_VARIABLES_ENABLED,
    }),
    [],
  );
}
