import { act, renderHook } from '@testing-library/react';

// Local (temporary URL-state) dashboards never hit the backend, so setDashboard
// must record the 'dashboard' onboarding task itself once a tile exists. These
// tests exercise that branch in isolation.

const mutate = jest.fn();
let localDashboardValue: unknown = null;
const setLocalDashboard = jest.fn((v: unknown) => {
  localDashboardValue = v;
});
let meData: {
  id: string;
  onboardingData: { completedTasks: string[]; isDismissed: boolean };
} | null = null;

// A real 24-hex ObjectId: recording is gated on the user id being persistable.
const REAL_USER_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';

jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('nuqs', () => ({
  parseAsJson: () => ({}),
  useQueryState: () => [localDashboardValue, setLocalDashboard],
}));
jest.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: jest.fn() }),
  useQuery: () => ({ data: undefined, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('../api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: meData }) },
  hdxServer: jest.fn(),
  useMarkOnboardingTaskComplete: () => jest.fn(),
  useCompleteOnboardingTask: () => ({ mutate }),
}));

import { useDashboard } from '@/dashboard';

const tile = {
  id: 't1',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  config: { name: 'c', source: 's', displayType: 'line', select: [] },
};

function makeDashboard(tiles: unknown[]) {
  return { id: '', name: 'Temp', tiles, tags: [] } as never;
}

describe('useDashboard local-dashboard onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localDashboardValue = null;
    meData = {
      id: REAL_USER_ID,
      onboardingData: { completedTasks: [], isDismissed: false },
    };
  });

  it('records the dashboard task when a tile is added to a temporary dashboard', () => {
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).toHaveBeenCalledWith('dashboard');
  });

  it('does not record for an empty temporary dashboard', () => {
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not re-record once the task is already completed', () => {
    meData = {
      id: REAL_USER_ID,
      onboardingData: { completedTasks: ['dashboard'], isDismissed: false },
    };
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not record when the user id is not a real ObjectId (noauth image)', () => {
    meData = {
      id: '_local_user_',
      onboardingData: { completedTasks: [], isDismissed: false },
    };
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
