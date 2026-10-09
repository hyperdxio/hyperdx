// Mirrors the local-mode tests in `dashboard.test.ts` but exercises the
// non-local branch of `fetchDashboards`: `hdxServer('dashboards').json<>()`
// followed by the same `normalizeDashboardTileColors` pass. The two files
// are split because `IS_LOCAL_MODE` is bound at module load and the two
// branches need different top-level mocks; `jest.doMock` inside
// `jest.isolateModules` did not override the hoisted `jest.mock` factory
// reliably enough to share a file.
jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('../api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: null }) },
  hdxServer: jest.fn(),
  useMarkOnboardingTaskComplete: () => jest.fn(),
  useInvalidateTags: () => jest.fn(),
  useCompleteOnboardingTask: () => ({ mutate: jest.fn() }),
}));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('nuqs', () => ({
  parseAsJson: jest.fn(),
  useQueryState: jest.fn(),
}));

// Capture each mutation's whole config (not just `mutationFn`) so tests can
// also assert on `scope` and `onSuccess`. Each `useMutation()` call appends
// its config to `mutationConfigs`; tests pull the most recently registered
// entry and invoke it as if `mutate({...})` had run.
const mutationConfigs: Array<{
  mutationFn: (input: any) => any;
  onSuccess?: (data: any) => void;
  scope?: { id: string };
}> = [];
const mutationFnCalls: Array<(input: any) => any> = [];
const setQueryData = jest.fn();
const invalidateQueries = jest.fn();
const getQueryData = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn((cfg: any) => {
    mutationConfigs.push(cfg);
    mutationFnCalls.push(cfg.mutationFn);
    return { mutate: jest.fn(), mutateAsync: jest.fn() };
  }),
  useQueryClient: jest.fn(() => ({
    setQueryData,
    invalidateQueries,
    getQueryData,
  })),
}));
jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { LEGACY_CHART_PALETTE_TOKEN_MAP } from '@hyperdx/common-utils/dist/types';

import { hdxServer } from '@/api';
import {
  fetchDashboards,
  normalizeRawDashboardTileColors,
  useCreateDashboard,
  useUpdateDashboard,
} from '@/dashboard';

const hdxServerMock = hdxServer as jest.Mock;

const LEGACY_TO_HUE_CASES = Object.entries(LEGACY_CHART_PALETTE_TOKEN_MAP);

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
  mutationConfigs.length = 0;
  mutationFnCalls.length = 0;
  setQueryData.mockReset();
  invalidateQueries.mockReset();
  getQueryData.mockReset();
  getQueryData.mockReturnValue(undefined);
});

describe('fetchDashboards (remote path)', () => {
  // Stored configs from #2265 (the initial number-tile color picker)
  // contain `color: 'chart-1'..'chart-10'`. The fetch-time normalizer
  // heals those values for any tile that comes back from the API, so
  // downstream consumers see the canonical hue tokens that
  // `ChartPaletteTokenSchema` accepts. Symmetric coverage with the
  // local-path suite in `dashboard.test.ts`.
  it.each(LEGACY_TO_HUE_CASES)(
    'migrates legacy %s → %s from a remote payload',
    async (legacy, hue) => {
      setRemotePayload(remoteDashboardWithTileColor(legacy));

      const result = await fetchDashboards();

      expect(hdxServerMock).toHaveBeenCalledWith('dashboards');
      expect(result[0].tiles[0].config).toMatchObject({ color: hue });
    },
  );

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

describe('useUpdateDashboard concurrency', () => {
  const dashboard = {
    id: 'd1',
    name: 'A',
    tiles: [],
    tags: [],
    version: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  // Regression guard for a real bug: mutationFn used to re-read the
  // dashboards cache for the token instead of trusting the version that
  // came in with the payload. That let a save whose payload was built from
  // an older render pass the guard with a sibling save's fresher cache
  // entry, silently overwriting the sibling's write with stale data. The
  // payload's own version must go out even when the cache holds a newer one.
  it('sends the version from the mutation payload, not a fresher one from the cache', async () => {
    const json = jest.fn().mockResolvedValue({ ...dashboard });
    hdxServerMock.mockReturnValue({ json });
    getQueryData.mockReturnValue([{ ...dashboard, version: 9 }]);

    useUpdateDashboard('d1');
    await mutationFnCalls.at(-1)!({
      ...dashboard,
      version: 1,
    });

    expect(hdxServerMock).toHaveBeenCalledWith('dashboards/d1', {
      method: 'PATCH',
      json: expect.objectContaining({
        expectedVersion: '1',
      }),
    });
  });

  // expectedVersion is a control field; sending version as document
  // state too would be noise the server has to strip.
  it('does not send version or updatedAt as document fields', async () => {
    const json = jest.fn().mockResolvedValue({ ...dashboard });
    hdxServerMock.mockReturnValue({ json });

    useUpdateDashboard('d1');
    await mutationFnCalls.at(-1)!(dashboard);

    expect(hdxServerMock.mock.calls.at(-1)![1].json).not.toHaveProperty(
      'version',
    );
    expect(hdxServerMock.mock.calls.at(-1)![1].json).not.toHaveProperty(
      'updatedAt',
    );
  });

  // invalidateQueries refetches asynchronously, so without a synchronous
  // cache write the next save would send the old token and 409 against
  // its own predecessor.
  it('writes the response into the dashboards cache on success', () => {
    useUpdateDashboard('d1');
    const cfg = mutationConfigs.at(-1)!;
    const updated = { ...dashboard, version: 2 };

    cfg.onSuccess!(updated);

    expect(setQueryData).toHaveBeenCalledWith(
      ['dashboards'],
      expect.any(Function),
    );
    const updater = setQueryData.mock.calls.at(-1)![1];
    expect(updater([dashboard])).toEqual([updated]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
  });

  it('leaves other dashboards in the cache alone', () => {
    useUpdateDashboard('d1');
    const cfg = mutationConfigs.at(-1)!;
    const other = { ...dashboard, id: 'd2', name: 'B' };

    cfg.onSuccess!({ ...dashboard, name: 'Renamed' });

    const updater = setQueryData.mock.calls.at(-1)![1];
    expect(updater([other])).toEqual([other]);
  });

  // TanStack serialises mutations sharing the same `scope.id` (HDX-4159);
  // under this wholesale mock we can only assert the key was passed, not
  // that serialisation actually happens.
  it('passes a per-dashboard scope key to the mutation', () => {
    useUpdateDashboard('d1');
    expect(mutationConfigs.at(-1)!.scope).toEqual({ id: 'dashboard-d1' });
  });

  it('leaves the scope unset for a local dashboard', () => {
    useUpdateDashboard(undefined);
    expect(mutationConfigs.at(-1)!.scope).toBeUndefined();
  });
});
