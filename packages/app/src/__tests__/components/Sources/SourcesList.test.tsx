import React from 'react';
import Router from 'next/router';
import { SourceKind } from '@berg/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SourcesList from '@/components/Sources/SourcesList';
import { useDeleteSource, useSources } from '@/source';
import { ConfirmProvider } from '@/useConfirm';

jest.mock('@/source', () => ({
  useSources: jest.fn(),
  useDeleteSource: jest.fn(),
  useSaveSource: jest
    .fn()
    .mockReturnValue({ mutate: jest.fn(), isPending: false }),
}));

// EditSourceModal pulls in useTableSchema → keep the mock surface minimal.
jest.mock('@/hooks/useTableSchema', () => ({
  useTableSchema: jest
    .fn()
    .mockReturnValue({ data: undefined, isLoading: false }),
}));

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn(), events: { on: jest.fn(), off: jest.fn() } },
  useRouter: () => ({
    pathname: '/sources/list',
    push: jest.fn(),
    events: { on: jest.fn(), off: jest.fn() },
  }),
}));

const mockUseSources = useSources as jest.Mock;
const mockUseDeleteSource = useDeleteSource as jest.Mock;
const mockRouter = Router as unknown as { push: jest.Mock };

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          {ui}
          <Notifications />
        </ConfirmProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}

const sampleSources = [
  {
    id: 'src-orders',
    name: 'orders source',
    displayName: 'Orders',
    kind: SourceKind.Table,
    catalog: 'AwsDataCatalog',
    database: 'sales',
    table: 'orders',
    timestampColumn: 'created_at',
    defaultSort: 'created_at DESC',
    connection: '',
    from: { databaseName: 'sales', tableName: 'orders' },
    timestampValueExpression: 'created_at',
  },
  {
    id: 'src-users',
    name: 'users source',
    displayName: 'Users (flat)',
    kind: SourceKind.Table,
    catalog: 'AwsDataCatalog',
    database: 'iam',
    table: 'users',
    connection: '',
    from: { databaseName: 'iam', tableName: 'users' },
    timestampValueExpression: '',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDeleteSource.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
});

describe('SourcesList', () => {
  it('renders sources from the hook with name + table reference', async () => {
    mockUseSources.mockReturnValue({
      data: sampleSources,
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));

    expect(await screen.findByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Users (flat)')).toBeInTheDocument();
    expect(screen.getByText('AwsDataCatalog/sales/orders')).toBeInTheDocument();
    expect(screen.getByText('AwsDataCatalog/iam/users')).toBeInTheDocument();
  });

  it('shows empty state when there are no sources', () => {
    mockUseSources.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));
    expect(screen.getByText(/No sources yet/i)).toBeInTheDocument();
  });

  it('filters by display name', async () => {
    mockUseSources.mockReturnValue({
      data: sampleSources,
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));

    const filter = screen.getByLabelText('Filter sources');
    await userEvent.type(filter, 'Orders');

    await waitFor(() => {
      expect(screen.getByText('Orders')).toBeInTheDocument();
    });
    expect(screen.queryByText('Users (flat)')).not.toBeInTheDocument();
  });

  it('filters by table reference', async () => {
    mockUseSources.mockReturnValue({
      data: sampleSources,
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));

    const filter = screen.getByLabelText('Filter sources');
    await userEvent.type(filter, 'iam/users');

    await waitFor(() => {
      expect(screen.getByText('Users (flat)')).toBeInTheDocument();
    });
    expect(screen.queryByText('Orders')).not.toBeInTheDocument();
  });

  it('opens delete confirm and calls the API on confirm', async () => {
    const mutate = jest.fn();
    mockUseDeleteSource.mockReturnValue({ mutate, isPending: false });
    mockUseSources.mockReturnValue({
      data: sampleSources,
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));

    const row = await screen.findByTestId('source-row-src-orders');
    const deleteBtn = within(row).getByLabelText(/Delete Orders/i);
    await userEvent.click(deleteBtn);

    // ConfirmProvider modal renders with confirm-confirm-button
    const confirmBtn = await screen.findByTestId('confirm-confirm-button');
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        { id: 'src-orders' },
        expect.any(Object),
      );
    });
  });

  it('routes to /search?source=:id when search action is clicked', async () => {
    mockUseSources.mockReturnValue({
      data: sampleSources,
      isLoading: false,
      isError: false,
    });

    render(wrap(<SourcesList />));

    const row = await screen.findByTestId('source-row-src-orders');
    const searchBtn = within(row).getByLabelText(/Open Orders in Search/i);
    await userEvent.click(searchBtn);

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/search',
      query: { source: 'src-orders' },
    });
  });
});
