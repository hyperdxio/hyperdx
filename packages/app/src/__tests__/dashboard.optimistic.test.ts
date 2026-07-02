jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('../api', () => ({ hdxServer: jest.fn() }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('nuqs', () => ({
  parseAsJson: jest.fn(),
  useQueryState: jest.fn(),
}));

type MutationConfig = {
  onMutate?: (input: any) => any;
  onError?: (error: unknown, input: any, context: any) => void;
  onSettled?: () => void;
};

const mutationConfigs: MutationConfig[] = [];

// A minimal in-memory query cache so getQueryData/setQueryData actually
// share state, letting a test prove two sequential onMutate calls compose
// instead of clobbering each other.
const store = new Map<string, unknown>();
const keyOf = (key: unknown) => JSON.stringify(key);

const queryClient = {
  cancelQueries: jest.fn().mockResolvedValue(undefined),
  invalidateQueries: jest.fn(),
  getQueryData: jest.fn((key: unknown) => store.get(keyOf(key))),
  setQueryData: jest.fn((key: unknown, updater: unknown) => {
    const current = store.get(keyOf(key));
    const next =
      typeof updater === 'function'
        ? (updater as (c: unknown) => unknown)(current)
        : updater;
    store.set(keyOf(key), next);
    return next;
  }),
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn((cfg: MutationConfig) => {
    mutationConfigs.push(cfg);
    return { mutate: jest.fn(), mutateAsync: jest.fn() };
  }),
  useQueryClient: jest.fn(() => queryClient),
}));
jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { useUpdateDashboard } from '@/dashboard';

const captureUpdateConfig = (
  hookFactory: () => unknown = useUpdateDashboard,
): MutationConfig => {
  hookFactory();
  return mutationConfigs[mutationConfigs.length - 1];
};

const seedCache = (dashboards: unknown[]) =>
  store.set(keyOf(['dashboards']), dashboards);

beforeEach(() => {
  mutationConfigs.length = 0;
  store.clear();
  queryClient.cancelQueries.mockClear();
  queryClient.invalidateQueries.mockClear();
  queryClient.getQueryData.mockClear();
  queryClient.setQueryData.mockClear();
});

const cached = () => store.get(keyOf(['dashboards'])) as any[];

describe('useUpdateDashboard optimistic cache update', () => {
  it('writes the pending change into the dashboards cache under the dashboards key', async () => {
    const cfg = captureUpdateConfig();
    seedCache([
      { id: 'a', name: 'A', tiles: [], tags: [], bordered: false },
      { id: 'b', name: 'B', tiles: [], tags: [] },
    ]);

    await cfg.onMutate?.({ id: 'a', bordered: true });

    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
    expect(queryClient.setQueryData.mock.calls[0][0]).toEqual(['dashboards']);
    expect(cached().find(d => d.id === 'a').bordered).toBe(true);
    expect(cached().find(d => d.id === 'b').name).toBe('B');
  });

  it('composes two sequential edits so neither clobbers the other (#2216)', async () => {
    const cfg = captureUpdateConfig();
    seedCache([{ id: 'a', name: 'A', tiles: [], tags: [], bordered: false }]);

    // Edit 1: toggle bordered. Edit 2 reads the already-updated cache.
    await cfg.onMutate?.({ id: 'a', bordered: true });
    await cfg.onMutate?.({ id: 'a', name: 'Renamed' });

    const dashboard = cached().find(d => d.id === 'a');
    expect(dashboard.bordered).toBe(true);
    expect(dashboard.name).toBe('Renamed');
  });

  it('leaves an empty cache untouched instead of writing undefined', async () => {
    const cfg = captureUpdateConfig();
    // No seedCache: the query has not resolved yet.
    await cfg.onMutate?.({ id: 'a', bordered: true });
    expect(store.get(keyOf(['dashboards']))).toBeUndefined();
  });

  it('rolls the cache back to the previous snapshot on error', async () => {
    const cfg = captureUpdateConfig();
    const previous = [{ id: 'a', name: 'A', tiles: [], tags: [] }];
    seedCache(previous);

    const context = await cfg.onMutate?.({ id: 'a', name: 'changed' });
    expect(cached()[0].name).toBe('changed');

    cfg.onError?.(new Error('boom'), { id: 'a' }, context);
    expect(cached()).toEqual(previous);
  });

  it('invalidates dashboards after settling', () => {
    const cfg = captureUpdateConfig();
    cfg.onSettled?.();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
  });
});
