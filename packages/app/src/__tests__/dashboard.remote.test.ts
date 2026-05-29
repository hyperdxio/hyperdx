// Mirrors the local-mode tests in `dashboard.test.ts` but exercises the
// non-local branch of `fetchDashboards`: `hdxServer('dashboards').json<>()`
// followed by the same `normalizeDashboardTileColors` pass. The two files
// are split because `IS_LOCAL_MODE` is bound at module load and the two
// branches need different top-level mocks; `jest.doMock` inside
// `jest.isolateModules` did not override the hoisted `jest.mock` factory
// reliably enough to share a file.
jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('../api', () => ({ hdxServer: jest.fn() }));
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

import { hdxServer } from '../api';
import { fetchDashboards } from '../dashboard';

const hdxServerMock = hdxServer as jest.Mock;

const remoteDashboardWithTileColor = (color: unknown) => [
  {
    id: 'a',
    name: 'A',
    tiles: [{ id: 't1', x: 0, y: 0, w: 4, h: 4, config: { color } }],
    tags: [],
  },
];

const setRemotePayload = (payload: unknown) => {
  hdxServerMock.mockReturnValue({
    json: jest.fn().mockResolvedValue(payload),
  });
};

beforeEach(() => {
  hdxServerMock.mockReset();
});

describe('fetchDashboards (remote path)', () => {
  // Stored configs from #2265 (the initial number-tile color picker)
  // contain `color: 'chart-1'..'chart-10'`. The fetch-time normalizer
  // heals those values for any tile that comes back from the API, so
  // downstream consumers see the canonical hue tokens that
  // `ChartPaletteTokenSchema` accepts. Symmetric coverage with the
  // local-path suite in `dashboard.test.ts`.
  it('migrates legacy chart-1..10 tokens from a remote payload', async () => {
    setRemotePayload(remoteDashboardWithTileColor('chart-1'));

    const result = await fetchDashboards();

    expect(hdxServerMock).toHaveBeenCalledWith('dashboards');
    expect(result[0].tiles[0].config).toMatchObject({ color: 'chart-green' });
  });

  it('migrates chart-10 to chart-gray on the remote path', async () => {
    setRemotePayload(remoteDashboardWithTileColor('chart-10'));

    const result = await fetchDashboards();

    expect(result[0].tiles[0].config).toMatchObject({ color: 'chart-gray' });
  });

  it('passes through hue-named tokens unchanged', async () => {
    setRemotePayload(remoteDashboardWithTileColor('chart-orange'));

    const result = await fetchDashboards();

    expect(result[0].tiles[0].config).toMatchObject({ color: 'chart-orange' });
  });

  it('preserves unknown color strings (no silent data loss)', async () => {
    setRemotePayload(remoteDashboardWithTileColor('chart-future-magenta'));

    const result = await fetchDashboards();

    expect(result[0].tiles[0].config).toMatchObject({
      color: 'chart-future-magenta',
    });
  });

  it('does not touch tiles whose config has no color field', async () => {
    setRemotePayload([
      {
        id: 'a',
        name: 'A',
        tiles: [
          { id: 't1', x: 0, y: 0, w: 4, h: 4, config: { displayType: 1 } },
        ],
        tags: [],
      },
    ]);

    const result = await fetchDashboards();

    expect(result[0].tiles[0].config).toEqual({ displayType: 1 });
  });
});
