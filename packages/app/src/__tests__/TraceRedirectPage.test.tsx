import React from 'react';
import { waitFor } from '@testing-library/react';

import { TraceRedirectPage } from '../../pages/trace/[traceId]';

const mockReplace = jest.fn();

let mockRouter = {
  isReady: true,
  query: {
    traceId: 'trace-123',
  },
  replace: mockReplace,
};

jest.mock('next/router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

describe('TraceRedirectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter = {
      isReady: true,
      query: {
        traceId: 'trace-123',
      },
      replace: mockReplace,
    };
  });

  it('redirects to search with the trace id query param', async () => {
    window.history.pushState({}, '', '/trace/trace-123');

    renderWithMantine(<TraceRedirectPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/search?traceId=trace-123');
    });
  });

  it('preserves existing query params such as source', async () => {
    window.history.pushState({}, '', '/trace/trace-123?source=trace-source');

    renderWithMantine(<TraceRedirectPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/search?source=trace-source&traceId=trace-123',
      );
    });
  });

  it('redirects after router readiness changes', async () => {
    mockRouter = {
      ...mockRouter,
      isReady: false,
    };
    window.history.pushState({}, '', '/trace/trace-123');

    const { unmount } = renderWithMantine(<TraceRedirectPage />);

    expect(mockReplace).not.toHaveBeenCalled();

    mockRouter = {
      ...mockRouter,
      isReady: true,
    };

    unmount();
    renderWithMantine(<TraceRedirectPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/search?traceId=trace-123');
    });
  });
});
