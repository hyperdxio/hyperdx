import { ListViewResource } from '@hyperdx/common-utils/dist/types';

import type { ListView } from '@/listView';

/**
 * Pinned system views that ship above the user's saved views in
 * the sidebar. Non-editable; no kebab menu. Lookup logic checks
 * `system:*` ids first before falling through to the API response
 * so a click on a system row still applies the same evaluator
 * pipeline as a user-created view.
 *
 * Dashboards get the full set. Saved searches drop
 * `has-active-alerts` until the SavedSearch alert analogue lands
 * in PR-6.
 */
export const SYSTEM_VIEW_ID_PREFIX = 'system:';

const DASHBOARD_SYSTEM_VIEWS: ListView[] = [
  {
    id: 'system:created-by-me',
    name: 'My dashboards',
    icon: '👤',
    resource: 'dashboard',
    rules: [{ kind: 'created-by-me' }],
    combinator: 'all',
    ordering: 0,
  },
  {
    id: 'system:recent-7d',
    name: 'Recently updated',
    icon: '⏱',
    resource: 'dashboard',
    rules: [{ kind: 'updated-within-days', days: 7 }],
    combinator: 'all',
    ordering: 0,
  },
  {
    id: 'system:has-active-alerts',
    name: 'With active alerts',
    icon: '🔔',
    resource: 'dashboard',
    rules: [{ kind: 'has-active-alerts' }],
    combinator: 'all',
    ordering: 0,
  },
  {
    id: 'system:untagged',
    name: 'Untagged',
    icon: '🏷',
    resource: 'dashboard',
    rules: [{ kind: 'untagged' }],
    combinator: 'all',
    ordering: 0,
  },
];

const SAVED_SEARCH_SYSTEM_VIEWS: ListView[] = DASHBOARD_SYSTEM_VIEWS.filter(
  // has-active-alerts is dashboard-specific until PR-6 lands the
  // saved-search alert analogue.
  v => v.rules.every(r => r.kind !== 'has-active-alerts'),
).map(v => ({ ...v, resource: 'savedSearch' as const }));

export function getDefaultListViews(resource: ListViewResource): ListView[] {
  return resource === 'dashboard'
    ? DASHBOARD_SYSTEM_VIEWS
    : SAVED_SEARCH_SYSTEM_VIEWS;
}

export function isSystemViewId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(SYSTEM_VIEW_ID_PREFIX);
}
