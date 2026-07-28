import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { hdxServer } from '@/api';
import { useIacImportManifest } from '@/components/Iac/useIacImportManifest';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {},
  hdxServer: jest.fn(),
}));

const mockHdxServer = jest.mocked(hdxServer);

function mockResponse(body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  mockHdxServer.mockReturnValue({
    json: () => Promise.resolve(body),
  } as unknown as ReturnType<typeof hdxServer>);
}

function renderManifestHook() {
  // No client-level retry override: the hook sets its own, and that is
  // precisely what the no-retry-on-schema-violation case asserts.
  const queryClient = new QueryClient();
  return renderHook(() => useIacImportManifest(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const VALID = {
  dashboards: [{ id: '1'.repeat(24), name: 'D1' }],
  alerts: [],
  savedSearches: [],
  sources: [],
  connections: [],
  webhooks: [],
};

describe('useIacImportManifest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the parsed manifest on a valid payload', async () => {
    mockResponse(VALID);

    const { result } = renderManifestHook();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dashboards).toHaveLength(1);
  });

  // The whole point of parsing rather than casting: server drift must surface
  // as an error, not flow into the generated Terraform.
  it('errors when the server payload violates the schema', async () => {
    mockResponse({
      ...VALID,
      connections: [{ id: 'x', name: 'C', platformProvisioned: 'false' }],
    });

    const { result } = renderManifestHook();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('errors when a required collection is missing entirely', async () => {
    const { webhooks: _omitted, ...missing } = VALID;
    mockResponse(missing);

    const { result } = renderManifestHook();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  // A schema violation is deterministic, so retrying it just re-issues the
  // six-query fan-out for nothing.
  it('does not retry a schema violation', async () => {
    mockResponse({ ...VALID, dashboards: 'not-an-array' });

    const { result } = renderManifestHook();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockHdxServer).toHaveBeenCalledTimes(1);
  });
});
