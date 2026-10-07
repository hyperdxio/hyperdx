import { SourceKind, TSourceNoId } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { screen } from '@testing-library/react';

import OnboardingModal from '@/components/OnboardingModal';

const mockConfig = { IS_PROMQL_ENABLED: true };
jest.mock('@/config', () => ({
  IS_CLICKHOUSE_BUILD: false,
  IS_LOCAL_MODE: false,
  get IS_PROMQL_ENABLED() {
    return mockConfig.IS_PROMQL_ENABLED;
  },
}));

const mockCreateSource = jest.fn();
const mockUpdateSource = jest.fn();
// Stable references: new objects on every render would re-run the modal's
// effects, which depend on them.
const mockSourcesResult = { data: [] };
const mockCreateSourceMutation = { mutateAsync: mockCreateSource };
const mockUpdateSourceMutation = { mutateAsync: mockUpdateSource };
jest.mock('@/source', () => ({
  pickTimeSeriesTable: jest.requireActual('@/source').pickTimeSeriesTable,
  PROMQL_TIMESTAMP_EXPRESSION:
    jest.requireActual('@/source').PROMQL_TIMESTAMP_EXPRESSION,
  inferTableSourceConfig: async ({ kind }: { kind: SourceKind }) => ({
    kind,
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
  }),
  useSources: () => mockSourcesResult,
  useCreateSource: () => mockCreateSourceMutation,
  useUpdateSource: () => mockUpdateSourceMutation,
  useDeleteSource: () => ({ mutateAsync: jest.fn() }),
}));

const mockConnectionsResult = {
  data: [{ id: 'conn-1', name: 'Default', host: 'http://localhost:8123' }],
};
jest.mock('@/connection', () => ({
  useConnections: () => mockConnectionsResult,
  useCreateConnection: () => ({ mutate: jest.fn() }),
}));

const mockMetadata = {
  getOtelTables: jest.fn(),
  getTimeSeriesTables: jest.fn(),
};
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => mockMetadata,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));
jest.mock('@/components/ConnectionForm', () => ({
  ConnectionForm: () => null,
}));
jest.mock('@/components/Sources/SourceForm', () => ({
  TableSourceForm: () => null,
}));
jest.mock('@/components/Sources/SourcesList', () => ({
  SourcesList: () => null,
}));

const OTEL_LOGS_ONLY = {
  database: 'otel',
  tables: { logs: 'otel_logs', metrics: {} },
};

const createdKinds = () =>
  mockCreateSource.mock.calls.map(
    ([{ source }]: [{ source: TSourceNoId }]) => source.kind,
  );

describe('OnboardingModal auto-detection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // The notifications store is global, so earlier tests' toasts linger.
    notifications.clean();
    jest.clearAllMocks();
    mockConfig.IS_PROMQL_ENABLED = true;
    mockCreateSource.mockImplementation(
      async ({ source }: { source: TSourceNoId }) => ({
        ...source,
        id: `${source.kind}-id`,
      }),
    );
    mockUpdateSource.mockResolvedValue(undefined);
    mockMetadata.getOtelTables.mockResolvedValue(OTEL_LOGS_ONLY);
    mockMetadata.getTimeSeriesTables.mockResolvedValue([
      { databaseName: 'default', tableName: 'metrics_ts' },
    ]);
  });

  it('creates a PromQL source for a detected TimeSeries table', async () => {
    renderWithMantine(<OnboardingModal />);

    await screen.findByText('Automatically detected and created 2 sources.');
    expect(mockMetadata.getTimeSeriesTables).toHaveBeenCalledWith({
      connectionId: 'conn-1',
    });
    expect(createdKinds()).toEqual([SourceKind.Log, SourceKind.Promql]);
    expect(mockCreateSource).toHaveBeenLastCalledWith({
      source: {
        kind: SourceKind.Promql,
        name: 'PromQL',
        connection: 'conn-1',
        from: { databaseName: 'default', tableName: 'metrics_ts' },
        timestampValueExpression: 'timestamp',
      },
    });
  });

  it('skips PromQL detection when PromQL is disabled', async () => {
    mockConfig.IS_PROMQL_ENABLED = false;

    renderWithMantine(<OnboardingModal />);

    await screen.findByText('Automatically detected and created 1 source.');
    expect(mockMetadata.getTimeSeriesTables).not.toHaveBeenCalled();
    expect(createdKinds()).toEqual([SourceKind.Log]);
  });

  it('creates a PromQL source when no OTel tables exist', async () => {
    mockMetadata.getOtelTables.mockResolvedValue(null);

    renderWithMantine(<OnboardingModal />);

    await screen.findByText('Automatically detected and created 1 source.');
    expect(createdKinds()).toEqual([SourceKind.Promql]);
  });

  it('keeps the other sources when the PromQL source fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateSource.mockImplementation(
      async ({ source }: { source: TSourceNoId }) => {
        if (source.kind === SourceKind.Promql) {
          throw new Error('boom');
        }
        return { ...source, id: `${source.kind}-id` };
      },
    );

    renderWithMantine(<OnboardingModal />);

    await screen.findByText('Automatically detected and created 1 source.');
    expect(createdKinds()).toEqual([SourceKind.Log, SourceKind.Promql]);
  });

  it('keeps OTel detection when TimeSeries detection fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockMetadata.getTimeSeriesTables.mockRejectedValue(new Error('boom'));

    renderWithMantine(<OnboardingModal />);

    await screen.findByText('Automatically detected and created 1 source.');
    expect(createdKinds()).toEqual([SourceKind.Log]);
  });

  it('falls back to manual setup when nothing is detected', async () => {
    mockMetadata.getOtelTables.mockResolvedValue(null);
    mockMetadata.getTimeSeriesTables.mockResolvedValue([]);

    renderWithMantine(<OnboardingModal />);

    await screen.findByText(
      'Lets set up a source table to query telemetry from.',
    );
    expect(mockCreateSource).not.toHaveBeenCalled();
  });
});
