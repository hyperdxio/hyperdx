import {
  collectDashboardTags,
  filterAndSortDashboards,
} from '@/components/Dashboards/dashboardsListUtils';
import type { Dashboard } from '@/dashboard';

function makeDashboard(
  partial: Partial<Dashboard> & { id: string },
): Dashboard {
  return { name: partial.id, tiles: [], tags: [], ...partial };
}

const defaults = {
  tab: 'all' as const,
  favoriteIds: new Set<string>(),
  tagFilter: [],
  search: '',
  sort: 'updated' as const,
};

describe('filterAndSortDashboards', () => {
  it('lists a dashboard once no matter how many tags it carries', () => {
    const dashboards = [
      makeDashboard({ id: 'a', name: 'Checkout', tags: ['prod', 'billing'] }),
      makeDashboard({ id: 'b', name: 'Staging', tags: ['staging'] }),
    ];

    const result = filterAndSortDashboards({ ...defaults, dashboards });

    expect(result.map(d => d.id)).toEqual(['a', 'b']);
  });

  it('keeps only dashboards carrying the selected tag', () => {
    const dashboards = [
      makeDashboard({ id: 'a', tags: ['prod', 'billing'] }),
      makeDashboard({ id: 'b', tags: ['staging'] }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tagFilter: ['prod'],
    });

    expect(result.map(d => d.id)).toEqual(['a']);
  });

  it('matches a selected tag regardless of casing', () => {
    const dashboards = [
      makeDashboard({ id: 'a', tags: ['Prod'] }),
      makeDashboard({ id: 'b', tags: ['prod'] }),
      makeDashboard({ id: 'c', tags: ['staging'] }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tagFilter: ['PROD'],
    });

    expect(result.map(d => d.id)).toEqual(['a', 'b']);
  });

  it('requires a dashboard to carry every selected tag', () => {
    const dashboards = [
      makeDashboard({ id: 'both', tags: ['prod', 'billing'] }),
      makeDashboard({ id: 'prod-only', tags: ['prod'] }),
      makeDashboard({ id: 'billing-only', tags: ['billing'] }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tagFilter: ['prod', 'billing'],
    });

    expect(result.map(d => d.id)).toEqual(['both']);
  });

  it('does not filter when the tag list is empty', () => {
    const dashboards = [
      makeDashboard({ id: 'a', tags: ['prod'] }),
      makeDashboard({ id: 'b', tags: [] }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tagFilter: [],
    });

    expect(result.map(d => d.id)).toEqual(['a', 'b']);
  });

  it('matches the search against both name and tags', () => {
    const dashboards = [
      makeDashboard({ id: 'a', name: 'Checkout', tags: [] }),
      makeDashboard({ id: 'b', name: 'Orders', tags: ['checkout-flow'] }),
      makeDashboard({ id: 'c', name: 'Infra', tags: [] }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      search: '  CHECKOUT ',
    });

    expect(result.map(d => d.id)).toEqual(['a', 'b']);
  });

  it('narrows the favorites tab to favorited dashboards', () => {
    const dashboards = [makeDashboard({ id: 'a' }), makeDashboard({ id: 'b' })];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tab: 'favorites',
      favoriteIds: new Set(['b']),
    });

    expect(result.map(d => d.id)).toEqual(['b']);
  });

  it('narrows the mine tab to dashboards created by the current user', () => {
    const dashboards = [
      makeDashboard({ id: 'a', createdBy: { email: 'me@hyperdx.io' } }),
      makeDashboard({ id: 'b', createdBy: { email: 'someone@hyperdx.io' } }),
      makeDashboard({ id: 'c' }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tab: 'mine',
      currentUserEmail: 'me@hyperdx.io',
    });

    expect(result.map(d => d.id)).toEqual(['a']);
  });

  it('shows nothing on the mine tab when the current user is unknown', () => {
    const dashboards = [
      makeDashboard({ id: 'a', createdBy: { email: 'me@hyperdx.io' } }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      tab: 'mine',
      currentUserEmail: undefined,
    });

    expect(result).toEqual([]);
  });

  it('sorts by most recently updated first', () => {
    const dashboards = [
      makeDashboard({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeDashboard({ id: 'new', updatedAt: '2026-03-01T00:00:00.000Z' }),
      makeDashboard({ id: 'mid', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ];

    const result = filterAndSortDashboards({ ...defaults, dashboards });

    expect(result.map(d => d.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts dashboards without a timestamp last', () => {
    const dashboards = [
      makeDashboard({ id: 'undated' }),
      makeDashboard({ id: 'dated', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ];

    const result = filterAndSortDashboards({ ...defaults, dashboards });

    expect(result.map(d => d.id)).toEqual(['dated', 'undated']);
  });

  it('sorts by name when asked', () => {
    const dashboards = [
      makeDashboard({ id: 'c', name: 'Checkout' }),
      makeDashboard({ id: 'a', name: 'Alerts' }),
      makeDashboard({ id: 'b', name: 'Billing' }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      sort: 'name',
    });

    expect(result.map(d => d.name)).toEqual(['Alerts', 'Billing', 'Checkout']);
  });

  it('sorts by most recently created when asked', () => {
    const dashboards = [
      makeDashboard({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeDashboard({ id: 'new', createdAt: '2026-03-01T00:00:00.000Z' }),
    ];

    const result = filterAndSortDashboards({
      ...defaults,
      dashboards,
      sort: 'created',
    });

    expect(result.map(d => d.id)).toEqual(['new', 'old']);
  });

  it('breaks timestamp ties by name so the order is stable', () => {
    const sameTime = '2026-01-01T00:00:00.000Z';
    const dashboards = [
      makeDashboard({ id: 'b', name: 'Bravo', updatedAt: sameTime }),
      makeDashboard({ id: 'a', name: 'Alpha', updatedAt: sameTime }),
    ];

    const result = filterAndSortDashboards({ ...defaults, dashboards });

    expect(result.map(d => d.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('does not mutate the input array', () => {
    const dashboards = [
      makeDashboard({ id: 'b', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeDashboard({ id: 'a', updatedAt: '2026-03-01T00:00:00.000Z' }),
    ];

    filterAndSortDashboards({ ...defaults, dashboards });

    expect(dashboards.map(d => d.id)).toEqual(['b', 'a']);
  });
});

describe('collectDashboardTags', () => {
  it('deduplicates and sorts tags across dashboards', () => {
    const dashboards = [
      makeDashboard({ id: 'a', tags: ['prod', 'billing'] }),
      makeDashboard({ id: 'b', tags: ['prod'] }),
      makeDashboard({ id: 'c', tags: [] }),
    ];

    expect(collectDashboardTags(dashboards)).toEqual(['billing', 'prod']);
  });
});
