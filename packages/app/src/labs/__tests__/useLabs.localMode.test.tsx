import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { hdxServer } from '@/api';
import { useLabs } from '@/labs/useLabs';

// Separate file because jest.mock is file-scoped and local mode is the only
// case that takes the localStorage path.
jest.mock('@/config', () => ({ IS_LOCAL_MODE: true }));

// Mirrors real local mode, where useMe()'s queryFn short-circuits to null.
jest.mock('@/api', () => {
  const { useQuery } = jest.requireActual('@tanstack/react-query');
  return {
    __esModule: true,
    ME_QUERY_KEY: ['me'],
    hdxServer: jest.fn(),
    default: {
      useMe: () => useQuery({ queryKey: ['me'], queryFn: () => null }),
    },
  };
});

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

const STORAGE_KEY = 'hdx-labs';
const mockHdxServer = jest.mocked(hdxServer);

function renderLabs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useLabs(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('useLabs in local mode', () => {
  it('never reports loading, since localStorage is synchronous', () => {
    const { result } = renderLabs();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.enabled).toEqual({ 'lab-a': false, 'lab-b': false });
  });

  it('reads opt-ins from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'lab-a': true }));

    const { result } = renderLabs();

    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));
    expect(result.current.enabled['lab-b']).toBe(false);
  });

  it('persists a toggle to localStorage without calling the API', async () => {
    const { result } = renderLabs();

    act(() => result.current.setLabEnabled('lab-b', true));

    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(true));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'lab-b': true,
    });
    // There is no API server in local mode; a request here would 404.
    expect(mockHdxServer).not.toHaveBeenCalled();
  });

  it('prunes ids that are no longer in the registry on write', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'lab-a': true, 'retired-lab': true }),
    );

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-b', true));

    await waitFor(() => expect(result.current.enabled['lab-b']).toBe(true));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'lab-a': true,
      'lab-b': true,
    });
  });

  it('clears the entry when a lab is switched off', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'lab-a': true }));

    const { result } = renderLabs();
    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(true));

    act(() => result.current.setLabEnabled('lab-a', false));

    await waitFor(() => expect(result.current.enabled['lab-a']).toBe(false));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({});
  });
});
