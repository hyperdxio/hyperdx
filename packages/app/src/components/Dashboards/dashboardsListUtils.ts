import type { Dashboard } from '@/dashboard';

export const DASHBOARD_TABS = [
  { value: 'all', label: 'All' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'mine', label: 'My dashboards' },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]['value'];

export const DASHBOARD_TAB_VALUES = DASHBOARD_TABS.map(t => t.value);

export const DASHBOARD_SORT_OPTIONS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'created', label: 'Recently created' },
] as const;

export type DashboardSort = (typeof DASHBOARD_SORT_OPTIONS)[number]['value'];

export const DASHBOARD_SORT_VALUES = DASHBOARD_SORT_OPTIONS.map(o => o.value);

export const DEFAULT_DASHBOARD_SORT: DashboardSort = 'updated';

export function isDashboardTab(value: string | null): value is DashboardTab {
  return DASHBOARD_TAB_VALUES.some(tab => tab === value);
}

export function isDashboardSort(value: string | null): value is DashboardSort {
  return DASHBOARD_SORT_VALUES.some(sort => sort === value);
}

/** Dashboards created before the API tracked timestamps have none, so they sort last. */
function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

function compare(a: Dashboard, b: Dashboard, sort: DashboardSort) {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'created':
      return timestamp(b.createdAt) - timestamp(a.createdAt);
    case 'updated':
      return timestamp(b.updatedAt) - timestamp(a.updatedAt);
  }
}

export function filterAndSortDashboards({
  dashboards,
  tab,
  favoriteIds,
  currentUserEmail,
  tagFilter,
  search,
  sort,
}: {
  dashboards: Dashboard[];
  tab: DashboardTab;
  favoriteIds: Set<string>;
  currentUserEmail?: string;
  tagFilter: string[];
  search: string;
  sort: DashboardSort;
}): Dashboard[] {
  let result = dashboards;

  if (tab === 'favorites') {
    result = result.filter(d => favoriteIds.has(d.id));
  } else if (tab === 'mine') {
    result = currentUserEmail
      ? result.filter(d => d.createdBy?.email === currentUserEmail)
      : [];
  }

  if (tagFilter.length > 0) {
    // The tag picker collapses case variants into one checkbox, so the filter
    // has to match whichever casing the dashboard actually stored.
    result = result.filter(d =>
      tagFilter.every(tag =>
        d.tags.some(t => t.toLowerCase() === tag.toLowerCase()),
      ),
    );
  }

  const query = search.trim().toLowerCase();
  if (query) {
    result = result.filter(
      d =>
        d.name.toLowerCase().includes(query) ||
        d.tags.some(t => t.toLowerCase().includes(query)),
    );
  }

  // Name breaks ties so equal timestamps don't reorder between renders.
  return result
    .slice()
    .sort((a, b) => compare(a, b, sort) || a.name.localeCompare(b.name));
}
