import { useMemo } from 'react';
import {
  describeOnClick,
  renderOnClickDashboard,
  renderOnClickExternal,
  renderOnClickSearch,
} from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { isSearchableSource, OnClick } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

/**
 * The action a row click should take. `url` is set when the row's
 * templates resolved successfully; the cell wrapper renders a real
 * `<a href={url}>` so the browser handles cmd-click, middle-click,
 * right-click, status bar preview, and keyboard activation natively.
 *
 * When `url` is null the row's templates failed (missing column, stale
 * source ID, etc.). The cell still renders as a clickable anchor so the
 * hover hint and click-shows-error UX from the original onClick work
 * (#2140 / #2141 / #2146 / #2148) keep working. `onClickError` is the
 * click handler that fires the notification.
 */
export type RowAction = {
  url: string | null;
  description: string;
  /** True when `url` points to an arbitrary external destination (the `external` onClick variant) */
  external?: boolean;
  onClickError?: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

/**
 * Returns a function that, given some row data, produces a `RowAction`
 * describing the configured onClick: the destination URL (when the row
 * resolves), a one-line description for the hover hint, and an
 * on-click error handler (when the row's templates failed).
 *
 * Returns null when no `onClick` is configured on the chart, so callers
 * can fall back to the legacy `getRowSearchLink` drilldown.
 *
 * Render-time calls to the returned function are silent: a failing row
 * produces `url: null` without raising a Mantine notification. The
 * notification fires only when the user clicks the failing row (via
 * `onClickError`), mirroring the pre-existing behavior.
 */
export function useOnClickLinkBuilder({
  onClick,
  dateRange,
}: {
  onClick: OnClick | undefined;
  dateRange: [Date, Date];
}): ((row: Record<string, unknown>) => RowAction) | null {
  const { data: sources } = useSources();
  const { data: dashboards } = useDashboards();

  const [sourceIdsByName, sourceIds, sourceNamesById] = useMemo(() => {
    const idsByName = new Map<string, string[]>();
    const ids = new Set<string>();
    const namesById = new Map<string, string>();
    for (const s of sources?.filter(isSearchableSource) ?? []) {
      ids.add(s.id);
      namesById.set(s.id, s.name);

      const existing = idsByName.get(s.name);
      if (existing) existing.push(s.id);
      else idsByName.set(s.name, [s.id]);
    }
    return [idsByName, ids, namesById];
  }, [sources]);

  const [dashboardIdsByName, dashboardIds, dashboardNamesById] = useMemo(() => {
    const idsByName = new Map<string, string[]>();
    const ids = new Set<string>();
    const namesById = new Map<string, string>();
    for (const d of dashboards ?? []) {
      ids.add(d.id);
      namesById.set(d.id, d.name);

      const existing = idsByName.get(d.name);
      if (existing) existing.push(d.id);
      else idsByName.set(d.name, [d.id]);
    }
    return [idsByName, ids, namesById];
  }, [dashboards]);

  return useMemo(() => {
    if (!onClick) return null;

    const description = describeOnClick({
      onClick,
      sourceNamesById,
      dashboardNamesById,
    });

    // Cache results by row reference so the same row producing N cells
    // doesn't re-run handlebars rendering + URLSearchParams construction
    // N times per render. The WeakMap is scoped to this closure, so a new
    // memo (different onClick / sources / dashboards) starts fresh.
    const cache = new WeakMap<Record<string, unknown>, RowAction>();

    const isExternal = onClick.type === 'external';

    const compute = (row: Record<string, unknown>): RowAction => {
      const renderResult =
        onClick.type === 'search'
          ? renderOnClickSearch({
              onClick,
              row,
              sourceIds,
              sourceIdsByName,
              dateRange,
            })
          : onClick.type === 'dashboard'
            ? renderOnClickDashboard({
                onClick,
                row,
                dashboardIds,
                dashboardIdsByName,
                dateRange,
              })
            : renderOnClickExternal({ onClick, row });

      if (renderResult.ok) {
        return {
          url: renderResult.url,
          description: isExternal ? renderResult.url : description,
          external: isExternal,
        };
      }

      const errorMessage = renderResult.error;
      return {
        url: null,
        description,
        onClickError: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          notifications.show({
            id: errorMessage,
            color: 'red',
            title: 'Link error',
            message: errorMessage,
          });
        },
      };
    };

    return (row: Record<string, unknown>): RowAction => {
      const cached = cache.get(row);
      if (cached) return cached;
      const result = compute(row);
      cache.set(row, result);
      return result;
    };
  }, [
    onClick,
    sourceIds,
    sourceIdsByName,
    sourceNamesById,
    dateRange,
    dashboardIds,
    dashboardIdsByName,
    dashboardNamesById,
  ]);
}
