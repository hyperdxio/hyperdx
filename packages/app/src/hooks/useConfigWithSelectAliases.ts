import { useMemo } from 'react';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';

/**
 * Returns the config with its SELECT aliases defined in `with`.
 *
 * A query that rebuilds the SELECT (pattern mining) drops aliases only the
 * original SELECT defined, e.g. `ServiceName as service`, so a filter on one
 * fails with "Unknown identifier". `isLoading` is true until the aliases are
 * known, so callers can hold the query rather than run it once without them.
 */
export function useConfigWithSelectAliases(
  config: BuilderChartConfigWithDateRange,
) {
  const { data: aliasMap, isLoading } = useAliasMapFromChartConfig(config);

  const configWithAliases = useMemo(
    () => ({
      ...config,
      with: aliasMapToWithClauses(aliasMap) ?? config.with,
    }),
    [config, aliasMap],
  );

  return { config: configWithAliases, isLoading };
}
