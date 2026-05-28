/*
 * Remote-path tests for `fetchDashboards`. Kept in a separate file
 * from `dashboard.test.ts` because that file mocks `IS_LOCAL_MODE`
 * to `true` for the entire suite — switching the same constant per
 * test via `jest.isolateModules` + `jest.doMock` proved unreliable
 * because `jest.mock` declarations are hoisted to the top of the
 * file. A second test file with its own file-level mocks is the
 * idiomatic Jest pattern for exercising the alternate branch.
 */

const mockJson = jest.fn();

jest.mock('../api', () => ({
  hdxServer: jest.fn(() => ({ json: mockJson })),
}));
jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
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

import { fetchDashboards } from '../dashboard';

beforeEach(() => {
  mockJson.mockReset();
});

describe('fetchDashboards remote-path normalization', () => {
  // The local-mode path is covered by `dashboard.test.ts` via
  // `fetchLocalDashboards`. This file mirrors that coverage for the
  // `hdxServer('dashboards').json<Dashboard[]>().then(...).map(
  // normalizeDashboardTileColors)` branch so the remote path doesn't
  // silently regress.
  it('migrates legacy chart-1..10 colors from server response', async () => {
    mockJson.mockResolvedValue([
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
            config: { color: 'chart-1' },
          },
          {
            id: 't2',
            x: 0,
            y: 0,
            w: 4,
            h: 4,
            config: { color: 'chart-2' },
          },
          {
            id: 't10',
            x: 0,
            y: 0,
            w: 4,
            h: 4,
            config: { color: 'chart-10' },
          },
        ],
        tags: [],
      },
    ]);
    const result = await fetchDashboards();
    expect(result[0].tiles[0].config).toMatchObject({ color: 'chart-green' });
    expect(result[0].tiles[1].config).toMatchObject({ color: 'chart-blue' });
    expect(result[0].tiles[2].config).toMatchObject({ color: 'chart-gray' });
  });

  it('leaves hue-named tokens unchanged on the remote path', async () => {
    mockJson.mockResolvedValue([
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
            config: { color: 'chart-orange' },
          },
        ],
        tags: [],
      },
    ]);
    const result = await fetchDashboards();
    expect(result[0].tiles[0].config).toMatchObject({
      color: 'chart-orange',
    });
  });

  it('preserves tile identity when no migration is needed', async () => {
    // Reconciliation hot path: if a fetched dashboard has nothing to
    // heal, the helper returns the same object reference so React's
    // `useQuery` consumers don't see a synthetic change.
    const tile = {
      id: 't1',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      config: { color: 'chart-blue' },
    };
    const dashboard = { id: 'a', name: 'A', tiles: [tile], tags: [] };
    mockJson.mockResolvedValue([dashboard]);
    const result = await fetchDashboards();
    expect(result[0]).toBe(dashboard);
    expect(result[0].tiles[0]).toBe(tile);
  });
});
