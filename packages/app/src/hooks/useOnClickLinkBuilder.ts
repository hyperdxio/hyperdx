import { useMemo } from 'react';
import {
  renderOnClickDashboard,
  renderOnClickSearch,
} from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { isSearchableSource, OnClick } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

/**
 * Returns a function that, given some row data, produces a URL for the
 * configured onClick action. Errors (unresolved names, malformed templates,
 * unknown sources) surface as Mantine toast notifications; the function
 * returns null in error cases.
 */
export function useOnClickLinkBuilder({
  onClick,
  dateRange,
}: {
  onClick: OnClick | undefined;
  dateRange: [Date, Date];
}): ((row: Record<string, unknown>) => string | null) | null {
  const { data: sources } = useSources();
  const { data: dashboards } = useDashboards();

  const [sourceIdsByName, sourceIds] = useMemo(() => {
    const map = new Map<string, string[]>();
    const set = new Set<string>();
    for (const s of sources?.filter(isSearchableSource) ?? []) {
      set.add(s.id);

      const existing = map.get(s.name);
      if (existing) existing.push(s.id);
      else map.set(s.name, [s.id]);
    }
    return [map, set];
  }, [sources]);

  const [dashboardIdsByName, dashboardIds] = useMemo(() => {
    const map = new Map<string, string[]>();
    const set = new Set<string>();
    for (const d of dashboards ?? []) {
      set.add(d.id);

      const existing = map.get(d.name);
      if (existing) existing.push(d.id);
      else map.set(d.name, [d.id]);
    }
    return [map, set];
  }, [dashboards]);

  return useMemo(() => {
    if (!onClick) return null;

    return (row: Record<string, unknown>) => {
      const showError = (message: string) => {
        notifications.show({
          id: message,
          color: 'red',
          title: 'Link error',
          message,
        });
      };

      const renderResult =
        onClick.type === 'search'
          ? renderOnClickSearch({
              onClick,
              row,
              sourceIds,
              sourceIdsByName,
              dateRange,
            })
          : renderOnClickDashboard({
              onClick,
              row,
              dashboardIds,
              dashboardIdsByName,
              dateRange,
            });

      if (!renderResult.ok) {
        showError(renderResult.error);
        return null;
      }

      return renderResult.url;
    };
  }, [
    onClick,
    sourceIds,
    sourceIdsByName,
    dateRange,
    dashboardIds,
    dashboardIdsByName,
  ]);
}
