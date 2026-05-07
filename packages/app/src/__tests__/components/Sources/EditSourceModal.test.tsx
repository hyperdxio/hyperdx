import React from 'react';
import { SourceKind } from '@berg/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditSourceModal } from '@/components/Sources/EditSourceModal';
import { useTableSchema } from '@/hooks/useTableSchema';
import { useSaveSource } from '@/source';

jest.mock('@/source', () => ({
  useSaveSource: jest.fn(),
}));

jest.mock('@/hooks/useTableSchema', () => ({
  useTableSchema: jest.fn(),
}));

const mockUseSaveSource = useSaveSource as jest.Mock;
const mockUseTableSchema = useTableSchema as jest.Mock;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>
        {ui}
        <Notifications />
      </QueryClientProvider>
    </MantineProvider>
  );
}

const schemaFixture = {
  catalogId: 'AwsDataCatalog',
  database: 'sales',
  table: 'orders',
  format: 'iceberg',
  location: 's3://x',
  partitionKeys: [],
  tableType: 'EXTERNAL_TABLE',
  columns: [
    { name: 'id', type: 'bigint', isPartition: false },
    { name: 'created_at', type: 'timestamp(6)', isPartition: false },
    {
      name: 'updated_at',
      type: 'timestamp(6) with time zone',
      isPartition: false,
    },
    { name: 'birth_date', type: 'date', isPartition: false },
    { name: 'name', type: 'varchar', isPartition: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTableSchema.mockReturnValue({ data: schemaFixture, isLoading: false });
});

describe('EditSourceModal', () => {
  it('shows only TIMESTAMP/DATE columns plus the None option in the time-column dropdown', async () => {
    const mutate = jest.fn();
    mockUseSaveSource.mockReturnValue({ mutate, isPending: false });

    render(
      wrap(
        <EditSourceModal
          opened
          onClose={jest.fn()}
          defaults={{
            catalog: 'AwsDataCatalog',
            database: 'sales',
            table: 'orders',
            displayName: 'orders',
          }}
        />,
      ),
    );

    const select = screen.getByTestId('edit-source-time-column');
    // The select renders an input. Click it to surface the dropdown options.
    const input = select.querySelector('input') as HTMLInputElement;
    await userEvent.click(input);

    expect(
      await screen.findByText(/None.*flat table mode/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/created_at \(timestamp\(6\)\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/updated_at \(timestamp\(6\) with time zone\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/birth_date \(date\)/i)).toBeInTheDocument();
    // Non-time columns must not appear as options
    expect(screen.queryByText(/^id \(bigint\)$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^name \(varchar\)$/)).not.toBeInTheDocument();
  });

  it('validates that display name is required', async () => {
    const mutate = jest.fn();
    mockUseSaveSource.mockReturnValue({ mutate, isPending: false });

    render(
      wrap(
        <EditSourceModal
          opened
          onClose={jest.fn()}
          defaults={{
            catalog: 'AwsDataCatalog',
            database: 'sales',
            table: 'orders',
          }}
        />,
      ),
    );

    // The Display name field is pre-filled from defaults.table — clear it.
    const nameInput = screen.getByLabelText(
      /Display name/i,
    ) as HTMLInputElement;
    await userEvent.clear(nameInput);

    const submit = screen.getByTestId('edit-source-submit');
    await userEvent.click(submit);

    expect(
      await screen.findByText(/Display name is required/i),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls save with the Berg-native payload on submit', async () => {
    const mutate = jest.fn();
    mockUseSaveSource.mockReturnValue({ mutate, isPending: false });

    render(
      wrap(
        <EditSourceModal
          opened
          onClose={jest.fn()}
          defaults={{
            catalog: 'AwsDataCatalog',
            database: 'sales',
            table: 'orders',
            displayName: 'Orders',
            timestampColumn: 'created_at',
          }}
        />,
      ),
    );

    const submit = screen.getByTestId('edit-source-submit');
    await userEvent.click(submit);

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const payload = mutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      kind: SourceKind.Table,
      displayName: 'Orders',
      catalog: 'AwsDataCatalog',
      database: 'sales',
      table: 'orders',
      timestampColumn: 'created_at',
    });
    // No id when saving from Catalog → POST path on the hook
    expect(payload.id).toBeUndefined();
  });

  it('passes id when editing an existing source so the hook does PUT', async () => {
    const mutate = jest.fn();
    mockUseSaveSource.mockReturnValue({ mutate, isPending: false });

    render(
      wrap(
        <EditSourceModal
          opened
          onClose={jest.fn()}
          source={{
            id: 'src-1',
            displayName: 'Orders',
            kind: SourceKind.Table,
            catalog: 'AwsDataCatalog',
            database: 'sales',
            table: 'orders',
            timestampColumn: 'created_at',
          }}
        />,
      ),
    );

    const submit = screen.getByTestId('edit-source-submit');
    await userEvent.click(submit);

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].id).toBe('src-1');
  });
});
