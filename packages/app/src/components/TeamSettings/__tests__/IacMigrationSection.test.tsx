import React from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import IacMigrationSection from '@/components/TeamSettings/IacMigrationSection';

// Indirected through a module-scope jest.fn so individual tests can vary the
// hook result; `jest.mock` factories are hoisted above module initialisers, so
// the factory may only close over the fn, never read it at hoist time.
const useIacImportManifest = jest.fn();
jest.mock('@/components/Iac/useIacImportManifest', () => ({
  useIacImportManifest: () => useIacImportManifest(),
}));

const MANIFEST = {
  dashboards: [
    { id: '1'.repeat(24), name: 'D1' },
    { id: '2'.repeat(24), name: 'D2' },
  ],
  alerts: [
    {
      id: '3'.repeat(24),
      name: 'A1',
      source: 'saved_search',
      savedSearchId: '4'.repeat(24),
    },
    { id: '5'.repeat(24), source: 'tile' },
  ],
  savedSearches: [{ id: '4'.repeat(24), name: 'S1' }],
  sources: [],
  connections: [{ id: '6'.repeat(24), name: 'Local ClickHouse' }],
  webhooks: [],
  truncatedTypes: [],
};

const refetch = jest.fn();
const downloadTextFile = jest.fn();
jest.mock('@/utils/downloadFile', () => ({
  downloadTextFile: (...args: unknown[]) => downloadTextFile(...args),
}));

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <IacMigrationSection />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('IacMigrationSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refetch.mockResolvedValue({ data: MANIFEST, isSuccess: true });
    useIacImportManifest.mockReturnValue({
      data: MANIFEST,
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch,
    });
  });

  it('shows per-type counts and the skipped-alert note', () => {
    renderSection();

    expect(screen.getByText('Dashboards (2)')).toBeInTheDocument();
    expect(screen.getByText('Alerts (2)')).toBeInTheDocument();
    expect(screen.getByText(/1 alert will be skipped/)).toBeInTheDocument();
  });

  it('downloads a .tf import file for the selected types', async () => {
    renderSection();

    fireEvent.click(screen.getByTestId('iac-download-button'));

    await waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(1));
    const [content, filename] = downloadTextFile.mock.calls[0];
    expect(filename).toBe('hyperdx-import.tf');
    expect(content).toContain('source  = "ClickHouse/clickhouse"');
    // All three default-selected types must appear together — asserting only
    // the dashboard would let a regression silently drop the other two.
    expect(content).toContain(
      `to = clickhouse_clickstack_dashboard.dashboard_${'1'.repeat(24)}`,
    );
    expect(content).toContain(
      `to = clickhouse_clickstack_dashboard.dashboard_${'2'.repeat(24)}`,
    );
    expect(content).toContain(
      `to = clickhouse_clickstack_alert.alert_${'3'.repeat(24)}`,
    );
    expect(content).toContain(
      `to = clickhouse_clickstack_saved_search.saved_search_${'4'.repeat(24)}`,
    );
    expect(content).not.toContain('5'.repeat(24)); // tile alert excluded
    expect(content).not.toContain('6'.repeat(24)); // connections not selected by default
  });

  // The manifest is cached for 60s. Building the file from that cache writes
  // out ids that may already be gone, and `terraform plan
  // -generate-config-out` then fails for every block in the file.
  it('rebuilds the file from a refetch rather than the cached manifest', async () => {
    refetch.mockResolvedValue({
      isSuccess: true,
      data: { ...MANIFEST, dashboards: [{ id: '9'.repeat(24), name: 'D9' }] },
    });
    renderSection();

    fireEvent.click(screen.getByTestId('iac-download-button'));

    await waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(1));
    expect(refetch).toHaveBeenCalledTimes(1);
    const [content] = downloadTextFile.mock.calls[0];
    expect(content).toContain('9'.repeat(24));
    expect(content).not.toContain('1'.repeat(24));
  });

  // TanStack keeps the last successful payload in `data` when a refetch
  // fails, so a truthiness check on `data` would happily write the stale file
  // this refetch exists to avoid. Mock the shape it actually produces.
  it('writes nothing when the pre-download refetch fails', async () => {
    refetch.mockResolvedValue({
      data: MANIFEST,
      isSuccess: false,
      status: 'error',
    });
    renderSection();

    fireEvent.click(screen.getByTestId('iac-download-button'));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('emits connections as locals when the Connections box is ticked', async () => {
    renderSection();

    fireEvent.click(screen.getByLabelText(/Connections \(1\)/));
    fireEvent.click(screen.getByTestId('iac-download-button'));

    await waitFor(() => expect(downloadTextFile).toHaveBeenCalled());
    const [content] = downloadTextFile.mock.calls.at(-1)!;
    expect(content).toContain('locals {');
    expect(content).toContain('# Local ClickHouse');
    expect(content).toContain(
      `connection_${'6'.repeat(24)}_id = "${'6'.repeat(24)}"`,
    );
    expect(content).not.toContain('clickhouse_clickstack_connection');
  });

  // The P1: a dashboard whose PromQL tiles the import round trip would delete
  // must be withheld, and the user told why rather than silently given fewer.
  it('withholds a dashboard with unexportable tiles and says so', async () => {
    const manifest = {
      ...MANIFEST,
      dashboards: [
        { id: '1'.repeat(24), name: 'D1' },
        { id: '7'.repeat(24), name: 'Has PromQL', unexportableTiles: true },
      ],
    };
    refetch.mockResolvedValue({ data: manifest, isSuccess: true });
    useIacImportManifest.mockReturnValue({
      data: manifest,
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch,
    });

    renderSection();

    expect(screen.getByText(/1 dashboard will be skipped/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('iac-download-button'));
    await waitFor(() => expect(downloadTextFile).toHaveBeenCalled());
    const [content] = downloadTextFile.mock.calls.at(-1)!;
    expect(content).toContain('1'.repeat(24));
    expect(content).not.toContain('7'.repeat(24));
  });

  // onDownload is an async click handler, so a throw would otherwise be an
  // unhandled rejection with the user seeing nothing happen at all.
  it('surfaces a failure to build the file instead of failing silently', async () => {
    refetch.mockResolvedValue({
      // A non-ObjectId id makes buildImportFile throw by design.
      data: { ...MANIFEST, dashboards: [{ id: 'not-an-objectid', name: 'X' }] },
      isSuccess: true,
    });

    renderSection();

    fireEvent.click(screen.getByTestId('iac-download-button'));

    await waitFor(() =>
      expect(screen.getByText("Couldn't build the file")).toBeInTheDocument(),
    );
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  // A capped listing otherwise reads as a complete export.
  it('warns when a selected type was truncated', () => {
    useIacImportManifest.mockReturnValue({
      data: { ...MANIFEST, truncatedTypes: ['dashboards'] },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch,
    });

    renderSection();

    expect(screen.getByText('Not everything is listed')).toBeInTheDocument();
    expect(screen.getByText(/dashboards/)).toBeInTheDocument();
  });

  // Warning about a capped listing the user did not tick is a false alarm —
  // their download is complete.
  it('stays silent when only an unselected type was truncated', () => {
    useIacImportManifest.mockReturnValue({
      data: { ...MANIFEST, truncatedTypes: ['webhooks'] },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch,
    });

    renderSection();

    expect(
      screen.queryByText('Not everything is listed'),
    ).not.toBeInTheDocument();
  });

  it('disables the download button when nothing is selected', () => {
    renderSection();

    for (const label of [
      /Dashboards \(2\)/,
      /Alerts \(2\)/,
      /Saved searches/,
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }

    expect(screen.getByTestId('iac-download-button')).toBeDisabled();
  });

  // A failed fetch previously rendered as "(0)" on every type, which is
  // indistinguishable from a team that genuinely has nothing to export.
  it('surfaces a fetch failure instead of showing an empty team', () => {
    useIacImportManifest.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch,
    });

    renderSection();

    expect(screen.getByText("Couldn't load resources")).toBeInTheDocument();
    expect(screen.getByTestId('iac-download-button')).toBeDisabled();
  });
});
