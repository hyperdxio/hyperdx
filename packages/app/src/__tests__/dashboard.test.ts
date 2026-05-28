jest.mock('../api', () => ({ hdxServer: jest.fn() }));
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

import { fetchLocalDashboards, getLocalDashboardTags } from '../dashboard';

const STORAGE_KEY = 'hdx-local-dashboards';

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

    it('migrates chart-1..10 to their HyperDX-slot-order hue equivalents', () => {
      storeDashboardWithTileColor('chart-1');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-green',
      });

      storeDashboardWithTileColor('chart-2');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-blue',
      });

      storeDashboardWithTileColor('chart-10');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-gray',
      });
    });

    it('passes through hue-named tokens unchanged', () => {
      storeDashboardWithTileColor('chart-orange');
      expect(fetchLocalDashboards()[0].tiles[0].config).toMatchObject({
        color: 'chart-orange',
      });
    });

    it('leaves unknown strings alone (no silent data loss)', () => {
      // A forward-compat or hand-edited value should survive the
      // normalizer untouched; render-time consumers can decide to
      // ignore it. The alternative — erasing the value — would be
      // worse than leaving it.
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
