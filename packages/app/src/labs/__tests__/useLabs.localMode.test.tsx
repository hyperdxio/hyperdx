import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

import { useLabs } from '@/labs/useLabs';

// Separate file because jest.mock is file-scoped and this is the only case that
// needs labs switched off at the deployment level.
jest.mock('@/config', () => ({ IS_LABS_ENABLED: false }));

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
  ],
}));

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

describe('useLabs in local mode', () => {
  it('never reports loading, and every lab is off', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useLabs(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    // Labs are unavailable here, not pending — a loading state would never
    // resolve, since there is no API server to answer.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.enabled).toEqual({ 'lab-a': false });
  });
});
