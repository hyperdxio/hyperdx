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

const queryClient = {
  cancelQueries: jest.fn().mockResolvedValue(undefined),
  invalidateQueries: jest.fn(),
  getQueryData: jest.fn(),
  setQueryData: jest.fn(),
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

beforeEach(() => {
  mutationConfigs.length = 0;
  queryClient.cancelQueries.mockClear();
  queryClient.invalidateQueries.mockClear();
  queryClient.getQueryData.mockReset();
  queryClient.setQueryData.mockReset();
});

describe('useUpdateDashboard optimistic cache update', () => {
  it('writes the pending change into the dashboards cache so a following read is not stale', async () => {
    const cfg = captureUpdateConfig();
    const existing = [
      { id: 'a', name: 'A', tiles: [], tags: [], bordered: false },
      { id: 'b', name: 'B', tiles: [], tags: [] },
    ];
    queryClient.getQueryData.mockReturnValue(existing);

    await cfg.onMutate?.({ id: 'a', bordered: true });

    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
    const updater = queryClient.setQueryData.mock.calls[0][1];
    const next = updater(existing);
    expect(next.find((d: any) => d.id === 'a').bordered).toBe(true);
    expect(next.find((d: any) => d.id === 'b')).toEqual(existing[1]);
  });

  it('rolls the cache back to the previous snapshot on error', async () => {
    const cfg = captureUpdateConfig();
    const previousDashboards = [{ id: 'a', name: 'A', tiles: [], tags: [] }];
    queryClient.getQueryData.mockReturnValue(previousDashboards);

    const context = await cfg.onMutate?.({ id: 'a', name: 'changed' });
    cfg.onError?.(new Error('boom'), { id: 'a' }, context);

    expect(queryClient.setQueryData).toHaveBeenLastCalledWith(
      ['dashboards'],
      previousDashboards,
    );
  });

  it('invalidates dashboards after settling', () => {
    const cfg = captureUpdateConfig();
    cfg.onSettled?.();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
  });
});
