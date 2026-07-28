import React from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

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
};

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
    useIacImportManifest.mockReturnValue({
      data: MANIFEST,
      isLoading: false,
      isError: false,
    });
  });

  it('shows per-type counts and the skipped tile-alert note', () => {
    renderSection();

    expect(screen.getByText('Dashboards (2)')).toBeInTheDocument();
    expect(screen.getByText('Alerts (2)')).toBeInTheDocument();
    expect(
      screen.getByText(/1 tile alert will be skipped/),
    ).toBeInTheDocument();
  });

  it('downloads a .tf import file for the selected types', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('iac-download-button'));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [content, filename] = downloadTextFile.mock.calls[0];
    expect(filename).toBe('hyperdx-import.tf');
    expect(content).toContain('source  = "ClickHouse/clickhouse"');
    // All three default-selected types must appear together — asserting only
    // the dashboard would let a regression silently drop the other two.
    expect(content).toContain('to = clickhouse_clickstack_dashboard.d1_11111');
    expect(content).toContain('to = clickhouse_clickstack_dashboard.d2_22222');
    expect(content).toContain('to = clickhouse_clickstack_alert.a1_33333');
    expect(content).toContain(
      'to = clickhouse_clickstack_saved_search.s1_44444',
    );
    expect(content).not.toContain('5'.repeat(24)); // tile alert excluded
    expect(content).not.toContain('6'.repeat(24)); // connections not selected by default
  });

  it('emits connections as locals when the Connections box is ticked', () => {
    renderSection();

    fireEvent.click(screen.getByLabelText(/Connections \(1\)/));
    fireEvent.click(screen.getByTestId('iac-download-button'));

    const [content] = downloadTextFile.mock.calls.at(-1)!;
    expect(content).toContain('locals {');
    expect(content).toContain(
      `local_clickhouse_66666_id = "${'6'.repeat(24)}"`,
    );
    expect(content).not.toContain('clickhouse_clickstack_connection');
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
    });

    renderSection();

    expect(screen.getByText("Couldn't load resources")).toBeInTheDocument();
    expect(screen.getByTestId('iac-download-button')).toBeDisabled();
  });
});
