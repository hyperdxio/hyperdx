// Exercises the 409-conflict toast in `useDashboard`'s `setDashboard`
// (dashboard.ts), which `dashboard.remote.test.ts` doesn't reach — that file
// drives `useUpdateDashboard` directly and never touches the `useDashboard`
// wrapper where the toast lives. Kept in its own file, with its own mocks,
// so this doesn't disturb the 28 tests already passing in the other file.
jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('../api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: null }) },
  hdxServer: jest.fn(),
  useMarkOnboardingTaskComplete: () => jest.fn(),
  useInvalidateTags: () => jest.fn(),
  useCompleteOnboardingTask: () => ({ mutate: jest.fn() }),
}));

const notificationsShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  notifications: { show: (...args: unknown[]) => notificationsShow(...args) },
}));

jest.mock('nuqs', () => ({
  parseAsJson: jest.fn(),
  useQueryState: jest.fn(() => [null, jest.fn()]),
}));

// `useUpdateDashboard`'s `mutate` is a plain jest.fn() here, so it never
// calls its own `onSuccess`/`onError`. Tests capture the options object
// `setDashboard` passed in and invoke `onError` themselves, as if the
// mutation had actually rejected.
const mutate = jest.fn();
const invalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({
    data: {
      id: 'd1',
      name: 'A',
      tiles: [],
      tags: [],
      updatedAt: '2026-09-04T01:02:03.456Z',
      version: 3,
    },
    isFetching: false,
  })),
  useMutation: jest.fn(() => ({ mutate, mutateAsync: jest.fn() })),
  useQueryClient: jest.fn(() => ({
    setQueryData: jest.fn(),
    invalidateQueries,
  })),
}));

jest.mock('@/utils', () => ({ hashCode: jest.fn(() => 0) }));

import { HTTPError } from 'ky';
import { act, renderHook } from '@testing-library/react';

import { useDashboard } from '@/dashboard';

// `dashboard.ts` does `instanceof HTTPError`, so the test needs a real
// instance rather than a plain object literal. Real ky's constructor wants
// (Response, Request, NormalizedOptions), but jsdom provides no `Response`
// global, so calling it here dies with a ReferenceError. Fabricating the
// prototype chain is what's left; the cast is the cost of that.
const httpError = (status: number) =>
  Object.assign(Object.create(HTTPError.prototype), {
    response: { status },
  }) as HTTPError;

beforeEach(() => {
  mutate.mockClear();
  invalidateQueries.mockClear();
  notificationsShow.mockClear();
});

describe('useDashboard 409 conflict handling', () => {
  const newDashboard = { id: 'd1', name: 'Edited', tiles: [], tags: [] };

  // Pins that `setDashboard` actually carries a version token into the
  // mutation at all — without this, deleting the `version` fallback
  // from `dashboard.ts` would pass every other test in this file, since
  // none of them inspect the mutation's variables (only its options).
  it('sends the read dashboard version in the mutation variables', () => {
    const { result } = renderHook(() => useDashboard({ dashboardId: 'd1' }));

    act(() => {
      result.current.setDashboard(newDashboard);
    });

    const variables = mutate.mock.calls.at(-1)![0];
    expect(variables.version).toBe(3);
  });

  async function triggerOnError(err: unknown) {
    const { result } = renderHook(() => useDashboard({ dashboardId: 'd1' }));

    act(() => {
      result.current.setDashboard(newDashboard);
    });

    const options = mutate.mock.calls.at(-1)![1];
    await act(async () => {
      await options.onError(err);
    });
  }

  it('shows a distinct toast and refetches on a 409', async () => {
    await triggerOnError(httpError(409));

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboards'],
    });
    expect(notificationsShow).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'yellow',
        title: 'Dashboard has newer changes',
        message: expect.stringContaining('Your change was not saved'),
      }),
    );
  });

  it('shows the generic red toast for a non-409 error', async () => {
    await triggerOnError(httpError(500));

    expect(notificationsShow).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'red',
        title: 'Unable to save dashboard',
      }),
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('shows the generic red toast for a non-HTTP error', async () => {
    await triggerOnError(new Error('boom'));

    expect(notificationsShow).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'red',
        title: 'Unable to save dashboard',
      }),
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
