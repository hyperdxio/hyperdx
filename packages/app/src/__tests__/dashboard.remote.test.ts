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

// Capture each mutation's `mutationFn` so the tests can invoke it directly
// without standing up a full React Query provider. Each `useMutation()`
// call appends its config to `mutationFnCalls`; tests pull the most
// recently registered fn and invoke it as if `mutate({...})` had run.
const mutationFnCalls: Array<(input: any) => any> = [];
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn((cfg: { mutationFn: (input: any) => any }) => {
    mutationFnCalls.push(cfg.mutationFn);
    return { mutate: jest.fn(), mutateAsync: jest.fn() };
  }),
  useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn() })),
}));
jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { hdxServer } from '../api';
import {
  fetchDashboards,
  normalizeRawDashboardTileColors,
  useCreateDashboard,
  useUpdateDashboard,
} from '../dashboard';

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
  mutationFnCalls.length = 0;
});

describe('fetchDashboards (remote path)', () => {
  // Stored configs from #2265 (the initial number-tile color picker)
  // contain `color: 'chart-1'..'chart-10'`. The fetch-time normalizer
  // heals those values for any tile that comes back from the API, so
  // downstream consumers see the canonical hue tokens that
  // `ChartPaletteTokenSchema` accepts. Symmetric coverage with the
  // local-path suite in `dashboard.test.ts`.
  it.each([
    ['chart-1', 'chart-green'],
    ['chart-2', 'chart-blue'],
    ['chart-3', 'chart-orange'],
    ['chart-4', 'chart-red'],
    ['chart-5', 'chart-cyan'],
    ['chart-6', 'chart-pink'],
    ['chart-7', 'chart-purple'],
    ['chart-8', 'chart-light-blue'],
    ['chart-9', 'chart-brown'],
    ['chart-10', 'chart-gray'],
  ])('migrates legacy %s → %s from a remote payload', async (legacy, hue) => {
    setRemotePayload(remoteDashboardWithTileColor(legacy));

    const result = await fetchDashboards();

    expect(hdxServerMock).toHaveBeenCalledWith('dashboards');
    expect(result[0].tiles[0].config).toMatchObject({ color: hue });
  });

  it('passes through hue-named tokens unchanged', async () => {
    setRemotePayload(remoteDashboardWithTileColor('chart-orange'));

    const result = await fetchDashboards();

    expect(result[0].tiles[0].config).toMatchObject({ color: 'chart-orange' });
  });

  it('leaves unresolvable color strings intact (no silent data loss)', async () => {
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

// Symmetric write-time coverage: dashboards constructed outside the
// fetch path (JSON import, presets, MCP payloads) hit
// `useCreateDashboard` / `useUpdateDashboard` directly. The strict
// server-side `ChartPaletteTokenSchema` would 400 a legacy `chart-N`
// here, so the mutations also call `normalizeDashboardTileColors`
// before serializing the body. These tests pin that contract.
describe('useCreateDashboard / useUpdateDashboard write-time normalization', () => {
  const captureMutation = (
    hookFactory: () => unknown,
  ): ((input: any) => any) => {
    hookFactory();
    const fn = mutationFnCalls[mutationFnCalls.length - 1];
    expect(fn).toBeDefined();
    return fn;
  };

  beforeEach(() => {
    // hdxServer is invoked as `hdxServer(url, opts).json<T>()` for POST
    // but as `hdxServer(url, opts)` for PATCH; mock to handle both.
    hdxServerMock.mockReturnValue({
      json: jest.fn().mockResolvedValue({ id: 'a' }),
    });
  });

  it('rewrites legacy chart-N to hue tokens before POST in useCreateDashboard', async () => {
    const create = captureMutation(useCreateDashboard);

    await create({
      name: 'D',
      tiles: [
        { id: 't1', x: 0, y: 0, w: 4, h: 4, config: { color: 'chart-1' } },
      ],
      tags: [],
    });

    expect(hdxServerMock).toHaveBeenCalledWith(
      'dashboards',
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({
          tiles: [
            expect.objectContaining({ config: { color: 'chart-green' } }),
          ],
        }),
      }),
    );
  });

  it('preserves unresolvable color through POST so the server can surface a clear schema error', async () => {
    const create = captureMutation(useCreateDashboard);

    await create({
      name: 'D',
      tiles: [
        {
          id: 't1',
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          config: { color: 'chart-future-magenta' },
        },
      ],
      tags: [],
    });

    const call = hdxServerMock.mock.calls[0];
    expect(call[1].json.tiles[0].config).toMatchObject({
      color: 'chart-future-magenta',
    });
  });

  it('rewrites legacy chart-N to hue tokens before PATCH in useUpdateDashboard', async () => {
    const update = captureMutation(useUpdateDashboard);

    await update({
      id: 'a',
      tiles: [
        { id: 't1', x: 0, y: 0, w: 4, h: 4, config: { color: 'chart-10' } },
      ],
    });

    expect(hdxServerMock).toHaveBeenCalledWith(
      'dashboards/a',
      expect.objectContaining({
        method: 'PATCH',
        json: expect.objectContaining({
          tiles: [expect.objectContaining({ config: { color: 'chart-gray' } })],
        }),
      }),
    );
  });

  it('passes hue tokens through unchanged in useUpdateDashboard', async () => {
    const update = captureMutation(useUpdateDashboard);

    await update({
      id: 'a',
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
    });

    const call = hdxServerMock.mock.calls[0];
    expect(call[1].json.tiles[0].config).toEqual({ color: 'chart-orange' });
  });
});

// Pre-validation walker used by `DBDashboardImportPage`. Operates on
// `unknown` so JSON-imported templates can be healed *before* the strict
// `DashboardTemplateSchema.safeParse` rejects legacy `chart-N` with an
// opaque enum error. Distinct from `normalizeDashboardTileColors` in
// that unresolvable strings are left in place so the schema can report
// the bad value via its native error path.
describe('normalizeRawDashboardTileColors', () => {
  it('rewrites legacy chart-N inside a tile config', () => {
    const input = {
      name: 'D',
      tiles: [{ config: { color: 'chart-2' } }],
    };
    expect(normalizeRawDashboardTileColors(input)).toEqual({
      name: 'D',
      tiles: [{ config: { color: 'chart-blue' } }],
    });
  });

  it('leaves unresolvable color strings in place for the schema to flag', () => {
    const input = { tiles: [{ config: { color: 'chart-future-magenta' } }] };
    const result = normalizeRawDashboardTileColors(input) as {
      tiles: Array<{ config: { color: string } }>;
    };
    expect(result.tiles[0].config.color).toBe('chart-future-magenta');
  });

  it('returns the input untouched when tiles is missing or non-array', () => {
    expect(normalizeRawDashboardTileColors({ name: 'D' })).toEqual({
      name: 'D',
    });
    expect(normalizeRawDashboardTileColors({ tiles: 'oops' })).toEqual({
      tiles: 'oops',
    });
    expect(normalizeRawDashboardTileColors(null)).toBeNull();
    expect(normalizeRawDashboardTileColors('not-an-object')).toBe(
      'not-an-object',
    );
  });

  it('preserves referential equality when nothing changes', () => {
    const input = { tiles: [{ config: { color: 'chart-orange' } }] };
    expect(normalizeRawDashboardTileColors(input)).toBe(input);
  });

  it('skips tiles whose config has no color', () => {
    const input = { tiles: [{ config: { displayType: 'line' } }] };
    expect(normalizeRawDashboardTileColors(input)).toBe(input);
  });
});
