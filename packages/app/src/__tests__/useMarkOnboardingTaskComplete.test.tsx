import type { MeApiResponse } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { useMarkOnboardingTaskComplete } from '@/api';

function makeMe(
  completedTasks: MeApiResponse['onboardingData']['completedTasks'],
) {
  return {
    id: 'u1',
    email: 'a@b.com',
    accessKey: 'k',
    name: 'User',
    createdAt: '',
    onboardingData: { completedTasks, isDismissed: false },
    team: { id: 't1', name: 'Team' },
    usageStatsEnabled: false,
    aiAssistantEnabled: false,
  } as unknown as MeApiResponse;
}

function setup(initialMe: MeApiResponse | null) {
  const queryClient = new QueryClient();
  if (initialMe !== null) {
    queryClient.setQueryData(['me'], initialMe);
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useMarkOnboardingTaskComplete(), {
    wrapper,
  });
  return { queryClient, mark: result.current };
}

describe('useMarkOnboardingTaskComplete', () => {
  it('appends the task to completedTasks in the me cache', () => {
    const { queryClient, mark } = setup(makeMe([]));

    act(() => mark('alert'));

    expect(
      queryClient.getQueryData<MeApiResponse>(['me'])?.onboardingData
        .completedTasks,
    ).toEqual(['alert']);
  });

  it('does not duplicate an already-completed task', () => {
    const { queryClient, mark } = setup(makeMe(['alert']));

    act(() => mark('alert'));

    expect(
      queryClient.getQueryData<MeApiResponse>(['me'])?.onboardingData
        .completedTasks,
    ).toEqual(['alert']);
  });

  it('preserves referential identity of sibling fields (no consumer fan-out)', () => {
    const { queryClient, mark } = setup(makeMe([]));
    const before = queryClient.getQueryData<MeApiResponse>(['me'])!;

    act(() => mark('dashboard'));

    const after = queryClient.getQueryData<MeApiResponse>(['me'])!;
    // Only onboardingData is a new object; team/name/etc keep their identity so
    // useMe consumers that read those don't see a change.
    expect(after.team).toBe(before.team);
    expect(after.onboardingData).not.toBe(before.onboardingData);
  });

  it('is a no-op when the me cache is empty', () => {
    const { queryClient, mark } = setup(null);

    act(() => mark('alert'));

    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });
});
