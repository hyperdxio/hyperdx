import { Control, Controller, FieldPath } from 'react-hook-form';
import {
  SourceKind,
  SourceSchema,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { TableSourceForm } from '@/components/Sources/SourceForm/SourceForm';
import { inferTableSourceConfig } from '@/source';

const mockConnections = [{ id: 'local', name: 'Local ClickHouse' }];
let mockMetadata = {};
let mockSource: TSource | undefined;
jest.mock('@/connection', () => ({
  useConnections: () => ({ data: mockConnections }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => mockMetadata,
}));
jest.mock('@/source', () => ({
  inferTableSourceConfig: jest.fn(),
  useSource: () => ({ data: mockSource }),
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
    mockSource = undefined;
    mockMetadata = {};
  });

  it.each([SourceKind.Log, SourceKind.Trace, SourceKind.Netflow])(
    'preserves saved %s mappings on replica changes and infers a newly selected table or kind',
    async kind => {
      mockSource = SourceSchema.parse({
        id: 'saved',
        name: 'Saved source',
        kind,
        connection: 'local',
        from: { databaseName: 'default', tableName: 'events' },
        timestampValueExpression: 'CustomTime',
        defaultTableSelectExpression: '*',
        bytesExpression: 'CustomBytes',
        packetsExpression: 'Packets',
        srcAddrExpression: 'SrcAddr',
        dstAddrExpression: 'DstAddr',
        srcPortExpression: 'SrcPort',
        dstPortExpression: 'DstPort',
        protocolExpression: 'Proto',
        durationExpression: 'Duration',
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
      });
      mockInfer.mockResolvedValue({
        kind,
        timestampValueExpression: 'Detected',
      });
      const view = render(<TableSourceForm sourceId="saved" />, {
        wrapper: MantineProvider,
      });
      for (const field of ['connection', 'from.databaseName', 'metadata']) {
        await act(async () => {
          if (field === 'metadata') {
            mockMetadata = {};
            view.rerender(<TableSourceForm sourceId="saved" />);
          } else {
            fireEvent.change(screen.getByLabelText(field), {
              target: { value: 'replica' },
            });
          }
        });
        expect(mockInfer).not.toHaveBeenCalled();
        expect(screen.getByLabelText('timestampValueExpression')).toHaveValue(
          'CustomTime',
        );
      }
      fireEvent.change(screen.getByLabelText('from.tableName'), {
        target: { value: 'new_events' },
      });
      await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByLabelText('timestampValueExpression')).toHaveValue(
          'Detected',
        ),
      );
      fireEvent.click(
        screen.getByRole('radio', {
          name: kind === SourceKind.Netflow ? 'Logs' : 'NetFlow',
        }),
      );
      await waitFor(() => expect(mockInfer).toHaveBeenCalledTimes(2));
    },
  );

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
    [
      SourceKind.Netflow,
      'from.databaseName',
      'other_database',
      { databaseName: 'other_database' },
    ],
    [
      SourceKind.Netflow,
      'connection',
      'other_connection',
      { connectionId: 'other_connection' },
    ],
    [
      SourceKind.Log,
      'connection',
      'other_connection',
      { connectionId: 'other_connection' },
    ],
    [
      SourceKind.Trace,
      'from.databaseName',
      'other_database',
      { databaseName: 'other_database' },
    ],
  ] as const)(
    'restarts new %s discovery for the same table after %s changes',
    async (kind, field, value, expected) => {
      const oldRequest = deferred();
      const latestRequest = deferred();
      mockInfer
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(latestRequest.promise);
      renderWithMantine(<TableSourceForm isNew defaultKind={kind} />);
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
