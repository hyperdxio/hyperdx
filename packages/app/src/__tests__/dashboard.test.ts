jest.mock('../api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: null }) },
  hdxServer: jest.fn(),
  useMarkOnboardingTaskComplete: () => jest.fn(),
  useCompleteOnboardingTask: () => ({ mutate: jest.fn() }),
}));
jest.mock('../config', () => ({ IS_LOCAL_MODE: true }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('nuqs', () => ({
  parseAsJson: jest.fn(),
  useQueryState: jest.fn(),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { LEGACY_CHART_PALETTE_TOKEN_MAP } from '@hyperdx/common-utils/dist/types';

import {
  type Dashboard,
  duplicateDashboard,
  fetchLocalDashboards,
  getLocalDashboardTags,
} from '@/dashboard';

const STORAGE_KEY = 'hdx-local-dashboards';

const LEGACY_TO_HUE_CASES = Object.entries(LEGACY_CHART_PALETTE_TOKEN_MAP);

beforeEach(() => {
  localStorage.clear();
});

describe('fetchLocalDashboards', () => {
  it('returns empty array when no dashboards exist', () => {
    expect(fetchLocalDashboards()).toEqual([]);
  });

  it('returns all stored dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'Dashboard A', tiles: [], tags: [] },
      { id: 'b', name: 'Dashboard B', tiles: [], tags: [] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(fetchLocalDashboards()).toHaveLength(2);
  });

  describe('legacy tile color migration (fetch-time normalizer)', () => {
    // Stored configs from #2265 (the initial number-tile color picker)
    // contain `color: 'chart-1'..'chart-10'`. The rename refactor swapped
    // those numeric tokens for hue-named ones and kept `ChartPaletteToken
    // Schema` strict, so legacy values must be healed at load time.
    const storeDashboardWithTileColor = (color: unknown) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'a',
            name: 'A',
            tiles: [
              {
                id: 't1',
                x: 0,
                y: 0,
                w: 4,
                h: 4,
                config: { color },
              },
            ],
            tags: [],
          },
        ]),
      );
    };

    // Drives every slot off the canonical `LEGACY_CHART_PALETTE_TOKEN_MAP`
    // so a future tweak to the mapping is caught here instead of by a
    // stored dashboard silently recoloring on the user's next reload.
    it.each(LEGACY_TO_HUE_CASES)('migrates legacy %s → %s', (legacy, hue) => {
      storeDashboardWithTileColor(legacy);
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: hue,
      });
    });

    it('passes through hue-named tokens unchanged', () => {
      storeDashboardWithTileColor('chart-orange');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-orange',
      });
    });

    it('leaves unresolvable color strings intact (no silent data loss)', () => {
      // A stale hex / hand-edited / future-rollback value is preserved
      // so the user's choice survives a render pass — the strict
      // server-side `ChartPaletteTokenSchema` surfaces a clear error on
      // next save instead of the normalizer quietly dropping the field
      // and irreversibly overwriting the user's pick.
      storeDashboardWithTileColor('chart-future-magenta');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-future-magenta',
      });
    });

    it('does not touch tiles whose config has no color field', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'a',
            name: 'A',
            tiles: [
              { id: 't1', x: 0, y: 0, w: 4, h: 4, config: { displayType: 1 } },
            ],
            tags: [],
          },
        ]),
      );
      expect(fetchLocalDashboards()[0].tiles[0].config).toEqual({
        displayType: 1,
      });
    });
  });
});

describe('getLocalDashboardTags', () => {
  it('returns empty array when no dashboards exist', () => {
    expect(getLocalDashboardTags()).toEqual([]);
  });

  it('returns empty array when dashboards have no tags', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: [] },
      { id: 'b', name: 'B', tiles: [], tags: [] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual([]);
  });

  it('collects tags from all dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: ['production'] },
      { id: 'b', name: 'B', tiles: [], tags: ['staging'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual(
      expect.arrayContaining(['production', 'staging']),
    );
    expect(getLocalDashboardTags()).toHaveLength(2);
  });

  it('deduplicates tags that appear on multiple dashboards', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [], tags: ['production', 'infra'] },
      { id: 'b', name: 'B', tiles: [], tags: ['production', 'billing'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    const tags = getLocalDashboardTags();
    expect(tags).toHaveLength(3);
    expect(tags).toEqual(
      expect.arrayContaining(['production', 'infra', 'billing']),
    );
  });

  it('handles dashboards with undefined tags', () => {
    const dashboards = [
      { id: 'a', name: 'A', tiles: [] },
      { id: 'b', name: 'B', tiles: [], tags: ['ops'] },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
    expect(getLocalDashboardTags()).toEqual(['ops']);
  });
});

describe('duplicateDashboard', () => {
  const makeDashboard = (overrides: Partial<Dashboard> = {}): Dashboard =>
    ({
      id: 'dash-1',
      name: 'Latency',
      tags: ['prod', 'team-a'],
      tiles: [
        {
          id: 'tile-1',
          x: 0,
          y: 0,
          w: 8,
          h: 10,
          containerId: 'c1',
          tabId: 't1',
          config: { name: 'p99', source: 'traces', alert: { threshold: 5 } },
        },
        {
          id: 'tile-2',
          x: 8,
          y: 0,
          w: 8,
          h: 10,
          config: { name: 'errors', source: 'logs' },
        },
      ],
      filters: [{ id: 'f1' }],
      savedQuery: 'level:error',
      savedQueryLanguage: 'lucene',
      containers: [{ id: 'c1', name: 'Group' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      createdBy: { email: 'a@b.co' },
      updatedBy: { email: 'a@b.co' },
      provisioned: true,
      ...overrides,
    }) as unknown as Dashboard;

  it('appends " (Copy)" to the name', () => {
    expect(duplicateDashboard(makeDashboard()).name).toBe('Latency (Copy)');
  });

  it('re-mints every tile id, keeping them unique and distinct from the source', () => {
    const source = makeDashboard();
    const copy = duplicateDashboard(source);

    const sourceIds = source.tiles.map(t => t.id);
    const copyIds = copy.tiles.map(t => t.id);

    expect(copyIds).toHaveLength(2);
    copyIds.forEach(id => expect(sourceIds).not.toContain(id));
    expect(new Set(copyIds).size).toBe(copyIds.length);
  });

  it('drops tile alerts but preserves the rest of each tile config and layout', () => {
    const copy = duplicateDashboard(makeDashboard());

    expect(copy.tiles.every(t => !('alert' in t.config))).toBe(true);
    expect(copy.tiles[0].config).toMatchObject({
      name: 'p99',
      source: 'traces',
    });
    expect(copy.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      w: 8,
      h: 10,
      containerId: 'c1',
      tabId: 't1',
    });
  });

  it('carries tags, filters, saved query and containers', () => {
    const copy = duplicateDashboard(makeDashboard());

    expect(copy.tags).toEqual(['prod', 'team-a']);
    expect(copy.filters).toEqual([{ id: 'f1' }]);
    expect(copy.savedQuery).toBe('level:error');
    expect(copy.savedQueryLanguage).toBe('lucene');
    expect(copy.containers).toEqual([{ id: 'c1', name: 'Group' }]);
  });

  it('copies the tags array rather than sharing the source reference', () => {
    const source = makeDashboard();
    const copy = duplicateDashboard(source);
    expect(copy.tags).not.toBe(source.tags);
  });

  it('omits server-owned and machine-managed fields', () => {
    const copy = duplicateDashboard(makeDashboard()) as Record<string, unknown>;

    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('createdAt');
    expect(copy).not.toHaveProperty('updatedAt');
    expect(copy).not.toHaveProperty('createdBy');
    expect(copy).not.toHaveProperty('updatedBy');
    expect(copy).not.toHaveProperty('provisioned');
  });

  it('does not mutate the source dashboard', () => {
    const source = makeDashboard();
    duplicateDashboard(source);

    expect(source.name).toBe('Latency');
    expect(source.tiles[0].id).toBe('tile-1');
    expect(source.tiles[0].config).toHaveProperty('alert');
  });
});
