import React from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CatalogTree } from '@/components/Catalog/CatalogTree';
import { useCatalogs } from '@/hooks/useCatalogs';
import { useDatabases } from '@/hooks/useDatabases';
import { useTables } from '@/hooks/useTables';

jest.mock('@/hooks/useCatalogs', () => ({ useCatalogs: jest.fn() }));
jest.mock('@/hooks/useDatabases', () => ({ useDatabases: jest.fn() }));
jest.mock('@/hooks/useTables', () => ({ useTables: jest.fn() }));

const mockUseCatalogs = useCatalogs as jest.Mock;
const mockUseDatabases = useDatabases as jest.Mock;
const mockUseTables = useTables as jest.Mock;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no children loaded — caller can override per test.
  mockUseDatabases.mockReturnValue({ data: undefined, isFetching: false });
  mockUseTables.mockReturnValue({ data: undefined, isFetching: false });
});

describe('CatalogTree', () => {
  it('renders catalogs from the hook', async () => {
    mockUseCatalogs.mockReturnValue({
      data: ['AwsDataCatalog', 's3tablescatalog/x'],
      isLoading: false,
      isError: false,
    });

    render(wrap(<CatalogTree onSelectTable={jest.fn()} />));

    expect(await screen.findByText('AwsDataCatalog')).toBeInTheDocument();
    expect(screen.getByText('s3tablescatalog/x')).toBeInTheDocument();
  });

  it('shows a loading state while catalogs are fetching', () => {
    mockUseCatalogs.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(wrap(<CatalogTree onSelectTable={jest.fn()} />));
    expect(screen.getByText(/Loading catalogs/i)).toBeInTheDocument();
  });

  it('shows an error state when catalogs fail to load', () => {
    mockUseCatalogs.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(wrap(<CatalogTree onSelectTable={jest.fn()} />));
    expect(screen.getByText(/Failed to load catalogs/i)).toBeInTheDocument();
  });

  it('expands a catalog to lazily load and show its databases', async () => {
    mockUseCatalogs.mockReturnValue({
      data: ['AwsDataCatalog'],
      isLoading: false,
      isError: false,
    });
    // useDatabases is called with `undefined` until expand → return undefined
    // first, then with 'AwsDataCatalog' return data.
    mockUseDatabases.mockImplementation((catalogId?: string) => ({
      data: catalogId === 'AwsDataCatalog' ? ['db1', 'db2'] : undefined,
      isFetching: false,
    }));

    render(wrap(<CatalogTree onSelectTable={jest.fn()} />));

    const catalogRow = await screen.findByText('AwsDataCatalog');
    await userEvent.click(catalogRow);

    await waitFor(() => expect(screen.getByText('db1')).toBeInTheDocument());
    expect(screen.getByText('db2')).toBeInTheDocument();
  });

  it('filters across catalogs by substring', async () => {
    mockUseCatalogs.mockReturnValue({
      data: ['AwsDataCatalog', 's3tablescatalog/foo'],
      isLoading: false,
      isError: false,
    });

    render(wrap(<CatalogTree onSelectTable={jest.fn()} />));
    const filterInput = screen.getByLabelText('Filter catalog tree');
    await userEvent.type(filterInput, 's3');

    await waitFor(() => {
      expect(screen.queryByText('AwsDataCatalog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('s3tablescatalog/foo')).toBeInTheDocument();
  });

  it('fires onSelectTable when a leaf table row is clicked', async () => {
    const onSelectTable = jest.fn();
    mockUseCatalogs.mockReturnValue({
      data: ['AwsDataCatalog'],
      isLoading: false,
      isError: false,
    });
    mockUseDatabases.mockImplementation((catalogId?: string) => ({
      data: catalogId === 'AwsDataCatalog' ? ['db1'] : undefined,
      isFetching: false,
    }));
    mockUseTables.mockImplementation(
      (catalogId?: string, database?: string) => ({
        data:
          catalogId === 'AwsDataCatalog' && database === 'db1'
            ? [
                {
                  database: 'db1',
                  table: 'orders',
                  format: 'iceberg',
                  tableType: 'EXTERNAL_TABLE',
                },
              ]
            : undefined,
        isFetching: false,
      }),
    );

    render(wrap(<CatalogTree onSelectTable={onSelectTable} />));

    await userEvent.click(await screen.findByText('AwsDataCatalog'));
    await userEvent.click(await screen.findByText('db1'));
    await userEvent.click(await screen.findByText('orders'));

    expect(onSelectTable).toHaveBeenCalledWith({
      catalogId: 'AwsDataCatalog',
      database: 'db1',
      table: 'orders',
    });
  });
});
