import React from 'react';
import type { MeApiResponse } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useIsLabEnabled, useLabs } from '@/labs/useLabs';

/**
 * The mocked `hdxServer`, typed as what it actually is rather than as ky's
 * `ResponsePromise`. Reaching for the real signature would mean asserting a
 * bare `{ json }` stub into a generic `json<T>()` interface, and the honest
 * narrow type here avoids that cast entirely. The hook only ever calls
 * `.json()` on the result.
 */
type HdxServerMock = jest.Mock<
  { json: () => Promise<unknown> },
  [string, { method?: string; json?: unknown }?]
>;

// A never-resolving /me keeps the query pending, which is how the OFF -> ON
// window is exercised.
const PENDING = Symbol('pending');

let meFixture: Partial<MeApiResponse> | null | typeof PENDING = null;

// `useMe` is mocked as a *real* useQuery over the same key rather than as a
// static return value. The optimistic update writes straight into the
// react-query cache, so the cache has to be the actual source of truth or the
// optimism and rollback assertions would be testing nothing.
jest.mock('@/api', () => {
  const { useQuery } = jest.requireActual('@tanstack/react-query');
  return {
    __esModule: true,
    ME_QUERY_KEY: ['me'],
    hdxServer: jest.fn(),
    default: {
      useMe: () =>
        useQuery({
          queryKey: ['me'],
          queryFn: () =>
            meFixture === PENDING
              ? new Promise(() => {
                  /* never resolves */
                })
              : meFixture,
        }),
    },
  };
});

// Explicit rather than relying on the env default: which store useLabs reads
// now hinges on this, and local mode is covered in useLabs.localMode.test.tsx.
jest.mock('@/config', () => ({ IS_LOCAL_MODE: false }));

jest.mock('@/labs/registry', () => ({
  LABS: [
    {
      id: 'lab-a',
      title: 'Lab A',
      description: 'A',
      addedAt: '2026-01-01',
      owner: '@test',
    },
    {
      id: 'lab-b',
      title: 'Lab B',
      description: 'B',
      addedAt: '2026-01-01',
      owner: '@test',
    },
  ],
}));

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

const { hdxServer: mockHdxServer } = jest.requireMock<{
  hdxServer: HdxServerMock;
}>('@/api');
const mockShow = jest.mocked(notifications.show);

function resolvePatch(body: unknown = { labs: {} }) {
  mockHdxServer.mockReturnValue({ json: () => Promise.resolve(body) });
}

/** Returns a `resolve`/`reject` pair so a test can hold the PATCH in flight. */
function deferPatch() {
  let settle: { resolve: () => void; reject: () => void };
  const promise = new Promise<unknown>((res, rej) => {
    settle = {
      resolve: () => res({ labs: {} }),
      reject: () => rej(new Error('nope')),
    };
  });
  mockHdxServer.mockReturnValue({ json: () => promise });

  return settle!;
}

function renderLabs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useLabs(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

/** The PATCH body the hook sent, as an object. */
function lastPatchBody() {
  const call = mockHdxServer.mock.calls.at(-1);
  return call?.[1]?.json;
}

beforeEach(() => {
  jest.clearAllMocks();
  meFixture = null;
  resolvePatch();
});

describe('useLabs', () => {
  it('reports loading and every lab off while /me is pending', async () => {
    meFixture = PENDING;

    const { result } = renderLabs();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.enabled).toEqual({
      'lab-a': false,
      'lab-b': false,
    });
  });

  it('reads every lab as off when /me carries no labs field', async () => {
    // The pre-existing-user path: the field is absent on documents created
    // before labs existed.
    meFixture = { name: 'Test' };

    const { result } = renderLabs();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toEqual({
      'lab-a': false,
      'lab-b': false,
    });
  });

  it('reflects stored opt-ins', async () => {
    meFixture = { labs: { 'lab-a': true } };

    const { result } = renderLabs();

    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));
    expect(result.current.enabled['lab-b']).toBe(false);
  });

  it('ignores stored ids that are not in the registry', async () => {
    // A graduated or retired lab. It must not reach a consumer.
    meFixture = { labs: { 'retired-lab': true, 'lab-a': true } };

    const { result } = renderLabs();

    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));
    expect(result.current.enabled).not.toHaveProperty('retired-lab');
    expect(Object.keys(result.current.enabled).sort()).toEqual([
      'lab-a',
      'lab-b',
    ]);
  });

  it('does not treat a non-boolean stored value as enabled', async () => {
    // Guards the `=== true` comparison rather than truthiness.
    meFixture = {
      labs: { 'lab-a': 'true' } as unknown as { 'lab-a': boolean },
    };

    const { result } = renderLabs();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled['lab-a']).toBe(false);
  });

  it('sends a full-replace payload that prunes unknown ids and omits disabled labs', async () => {
    meFixture = { labs: { 'lab-a': true, 'retired-lab': true } };

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-b', true));

    await waitFor(() => expect(mockHdxServer).toHaveBeenCalled());
    expect(mockHdxServer).toHaveBeenCalledWith(
      'me/labs',
      expect.objectContaining({ method: 'PATCH' }),
    );
    // retired-lab is gone, and nothing is stored as `false`.
    expect(lastPatchBody()).toEqual({
      labs: { 'lab-a': true, 'lab-b': true },
    });
  });

  it('sends an empty set when the last enabled lab is switched off', async () => {
    meFixture = { labs: { 'lab-a': true } };

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-a', false));

    await waitFor(() => expect(mockHdxServer).toHaveBeenCalled());
    expect(lastPatchBody()).toEqual({ labs: {} });
  });

  it('applies the toggle optimistically before the request settles', async () => {
    meFixture = { labs: {} };
    const settle = deferPatch();

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setLabEnabled('lab-b', true));

    // Still in flight, but the UI already shows the new state.
    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(true));
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      settle.resolve();
    });
  });

  it('serializes overlapping toggles so an older payload cannot land last', async () => {
    // Without a mutation scope both requests fly concurrently, and if the first
    // one's response lands last the server keeps its payload — dropping the
    // second lab, which the next /me refetch then reverts in the UI.
    meFixture = { labs: {} };
    const first = deferPatch();

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setLabEnabled('lab-a', true));
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-b', true));
    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(true));

    // The second toggle is queued behind the first, not racing it.
    expect(mockHdxServer).toHaveBeenCalledTimes(1);
    expect(lastPatchBody()).toEqual({ labs: { 'lab-a': true } });

    // Let the first finish; the queued one then sends the cumulative set. The
    // fixture stands in for the persisted document once both writes have landed
    // in order, so the refetch that onSettled triggers is what proves the second
    // toggle survives rather than reverting.
    meFixture = { labs: { 'lab-a': true, 'lab-b': true } };
    resolvePatch();
    await act(async () => {
      first.resolve();
    });

    await waitFor(() => expect(mockHdxServer).toHaveBeenCalledTimes(2));
    expect(lastPatchBody()).toEqual({ labs: { 'lab-a': true, 'lab-b': true } });
    await waitFor(() =>
      expect(result.current.enabled).toEqual({
        'lab-a': true,
        'lab-b': true,
      }),
    );
  });

  it('rolls back and notifies when the request fails', async () => {
    meFixture = { labs: { 'lab-a': true } };
    const settle = deferPatch();

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-b', true));
    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(true));

    await act(async () => {
      settle.reject();
    });

    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(false));
    // The pre-existing opt-in survived the rollback.
    expect(result.current.enabled['lab-a']).toBe(true);
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'red' }),
    );
  });
});

describe('useIsLabEnabled', () => {
  function renderIsEnabled(labId: string) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return renderHook(() => useIsLabEnabled(labId), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });
  }

  it('returns true only for an enabled lab', async () => {
    meFixture = { labs: { 'lab-a': true } };

    const { result } = renderIsEnabled('lab-a');

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false for an id with no registry entry', async () => {
    meFixture = { labs: { 'retired-lab': true } };

    const { result } = renderIsEnabled('retired-lab');

    // Deleting a registry entry is safe: the gate goes false rather than
    // throwing. The flip side is that a typo fails silently.
    await waitFor(() => expect(result.current).toBe(false));
  });
});
