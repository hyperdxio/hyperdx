import { useMemo, useRef } from 'react';
import {
  buildDashboardLinkUrl,
  buildSearchLinkUrlFromPieces,
  DashboardLookup,
  renderSearchLinkPieces,
} from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { TableOnClick } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

type ResolverArgs = {
  onClick: TableOnClick | undefined;
  dateRange: [Date, Date];
};

/**
 * Returns a function that, given a table row, produces a URL for the
 * configured onClick action. Errors (unresolved names, malformed templates,
 * unknown sources) surface as Mantine toast notifications; the function
 * returns null in those cases so the row renders as non-clickable text.
 */
export function useTableOnClickResolver({
  onClick,
  dateRange,
}: ResolverArgs): ((row: Record<string, unknown>) => string | null) | null {
  const { data: dashboards } = useDashboards();
  const { data: sources } = useSources();
  // Avoid spamming toasts for the same error repeatedly as the user scrolls
  // through identical rows — dedupe by error message within a resolver.
  const shownErrorsRef = useRef<Set<string>>(new Set());

  const lookup: DashboardLookup = useMemo(() => {
    // Names aren't unique per team, so key by case-insensitive name → list of
    // matching ids. The URL builder surfaces an error when a rendered name
    // resolves to 0 or more than 1 match.
    const nameToIds = new Map<string, string[]>();
    for (const d of dashboards ?? []) {
      const key = d.name.trim().toLowerCase();
      if (!key) continue;
      const list = nameToIds.get(key) ?? [];
      list.push(d.id);
      nameToIds.set(key, list);
    }
    return { nameToIds };
  }, [dashboards]);

  const sourcesById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const s of sources ?? []) map.set(s.id, { id: s.id, name: s.name });
    return map;
  }, [sources]);

  const sourcesByName = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const s of sources ?? [])
      map.set(s.name.toLowerCase(), { id: s.id, name: s.name });
    return map;
  }, [sources]);

  return useMemo(() => {
    if (!onClick || onClick.type === 'none') return null;

    return (row: Record<string, unknown>) => {
      const showError = (message: string) => {
        if (shownErrorsRef.current.has(message)) return;
        shownErrorsRef.current.add(message);
        notifications.show({ color: 'red', title: 'Link error', message });
      };

      if (onClick.type === 'dashboard') {
        const result = buildDashboardLinkUrl({
          onClick,
          row,
          dateRange,
          dashboards: lookup,
        });
        if (!result.ok) {
          showError(result.error);
          return null;
        }
        return result.url;
      }

      // search mode
      const pieces = renderSearchLinkPieces({
        onClick,
        row,
        sourcesById,
        sourcesByName,
      });
      if (!pieces.ok) {
        showError(pieces.error);
        return null;
      }
      return buildSearchLinkUrlFromPieces({ pieces: pieces.value, dateRange });
    };
  }, [onClick, lookup, sourcesById, sourcesByName, dateRange]);
}
