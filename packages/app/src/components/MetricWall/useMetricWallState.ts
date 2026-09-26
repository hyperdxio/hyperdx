import { useCallback, useMemo } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';

import { MetricFilterClause } from './tileDefaults';
import { WallGrouping } from './wallGrouping';

export type ExpandedTile = {
  metricId: string;
  entity?: MetricFilterClause;
  /** Aggregation override; only lives as long as the drill-down. */
  agg?: string;
  splitBy?: string;
  multiples?: boolean;
};

export type MetricWallState = {
  query?: string;
  grouping?: WallGrouping;
  /** Attribute whose values the rail is listing. */
  railKey?: string;
  tile?: ExpandedTile;
};

export function useMetricWallState() {
  const [raw, setRaw] = useQueryState(
    'metricWall',
    parseAsJson<MetricWallState>(),
  );
  const state = useMemo(() => raw ?? {}, [raw]);
  const update = useCallback(
    (patch: Partial<MetricWallState>) => {
      setRaw(prev => {
        const next = { ...(prev ?? {}), ...patch };
        return Object.values(next).some(v => v != null && v !== '')
          ? next
          : null;
      });
    },
    [setRaw],
  );
  return [state, update] as const;
}
