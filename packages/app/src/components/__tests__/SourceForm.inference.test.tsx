import { Control, Controller, FieldPath } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { TableSourceForm } from '@/components/Sources/SourceForm/SourceForm';
import { inferTableSourceConfig } from '@/source';

const mockConnections = [{ id: 'local', name: 'Local ClickHouse' }];
const mockMetadata = {};
jest.mock('@/connection', () => ({
  useConnections: () => ({ data: mockConnections }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => mockMetadata,
}));
jest.mock('@/source', () => ({
  inferTableSourceConfig: jest.fn(),
  useSource: () => ({ data: undefined }),
  useSources: () => ({ data: [] }),
  useCreateSource: () => ({ mutate: jest.fn() }),
  useUpdateSource: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useDeleteSource: () => ({ mutate: jest.fn() }),
}));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

function MockInput({
  control,
  name,
}: {
  control: Control<TSource>;
  name: FieldPath<TSource>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <input
          {...field}
          aria-label={name}
          value={typeof field.value === 'string' ? field.value : ''}
        />
      )}
    />
  );
}
jest.mock('@/components/ConnectionSelect', () => ({
  ConnectionSelectControlled: MockInput,
}));
jest.mock('@/components/DatabaseSelect', () => ({
  DatabaseSelectControlled: MockInput,
}));
jest.mock('@/components/DBTableSelect', () => ({
  DBTableSelectControlled: MockInput,
}));
jest.mock('@/components/InputControlled', () => ({
  InputControlled: MockInput,
  AutocompleteControlled: MockInput,
}));
jest.mock('@/components/ConfirmDeleteMenu', () => () => null);
jest.mock('@/components/Sources/SourceForm/TableModelForm', () => ({
  TableModelForm: ({ control }: { control: Control<TSource> }) => (
    <>
      <MockInput control={control} name="timestampValueExpression" />
      <MockInput control={control} name="bytesExpression" />
    </>
  ),
}));

const mockInfer = jest.mocked(inferTableSourceConfig);
const deferred = () =>
  Promise.withResolvers<Awaited<ReturnType<typeof inferTableSourceConfig>>>();

describe('Source form asynchronous inference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a NetFlow response that arrives after the user selects Logs', async () => {
    const oldRequest = deferred();
    const latestRequest = deferred();
    mockInfer
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(latestRequest.promise);
    renderWithMantine(
      <TableSourceForm isNew defaultKind={SourceKind.Netflow} />,
    );
    fireEvent.change(screen.getByLabelText('from.tableName'), {
      target: { value: 'flows' },
    });
    await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('radio', { name: 'Logs' }));
    await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(2));
    await act(async () =>
      latestRequest.resolve({
        kind: SourceKind.Log,
        timestampValueExpression: 'LogTime',
      }),
    );
    await act(async () =>
      oldRequest.resolve({
        kind: SourceKind.Netflow,
        timestampValueExpression: 'FlowTime',
      }),
    );
    expect(screen.getByRole('radio', { name: 'Logs' })).toBeChecked();
    expect(screen.getByLabelText('timestampValueExpression')).toHaveValue(
      'LogTime',
    );
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest table inference and a mapping edited while it loads', async () => {
    const oldRequest = deferred();
    const latestRequest = deferred();
    mockInfer
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(latestRequest.promise);
    renderWithMantine(
      <TableSourceForm isNew defaultKind={SourceKind.Netflow} />,
    );
    fireEvent.change(screen.getByLabelText('from.tableName'), {
      target: { value: 'old_flows' },
    });
    await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('from.tableName'), {
      target: { value: 'new_flows' },
    });
    await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('bytesExpression'), {
      target: { value: 'CustomBytes * 2' },
    });
    await act(async () =>
      latestRequest.resolve({
        kind: SourceKind.Netflow,
        timestampValueExpression: 'NewTime',
        bytesExpression: 'NewBytes',
      }),
    );
    await act(async () =>
      oldRequest.resolve({
        kind: SourceKind.Netflow,
        timestampValueExpression: 'OldTime',
        bytesExpression: 'OldBytes',
      }),
    );
    expect(screen.getByLabelText('timestampValueExpression')).toHaveValue(
      'NewTime',
    );
    expect(screen.getByLabelText('bytesExpression')).toHaveValue(
      'CustomBytes * 2',
    );
    expect(notifications.show).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['from.databaseName', 'other_database', { databaseName: 'other_database' }],
    ['connection', 'other_connection', { connectionId: 'other_connection' }],
  ] as const)(
    'restarts discovery for the same table after %s changes',
    async (field, value, expected) => {
      const oldRequest = deferred();
      const latestRequest = deferred();
      mockInfer
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(latestRequest.promise);
      renderWithMantine(
        <TableSourceForm isNew defaultKind={SourceKind.Netflow} />,
      );
      fireEvent.change(screen.getByLabelText('from.tableName'), {
        target: { value: 'flows' },
      });
      await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByLabelText(field), { target: { value } });
      await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(2));
      expect(mockInfer).toHaveBeenLastCalledWith(
        expect.objectContaining({ tableName: 'flows', ...expected }),
      );
      await act(async () =>
        latestRequest.resolve({
          kind: SourceKind.Netflow,
          timestampValueExpression: 'NewTime',
        }),
      );
      await act(async () =>
        oldRequest.resolve({
          kind: SourceKind.Netflow,
          timestampValueExpression: 'OldTime',
        }),
      );
      expect(screen.getByLabelText('timestampValueExpression')).toHaveValue(
        'NewTime',
      );
      expect(notifications.show).toHaveBeenCalledTimes(1);
    },
  );
});
