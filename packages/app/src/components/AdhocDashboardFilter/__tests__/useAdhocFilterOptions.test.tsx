import { ReactNode } from 'react';
import { ColumnMeta, JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import {
  AdhocDashboardFilter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  getSourcesWithKey,
  getSqlSourceColumnKeys,
  getSqlSourceKeys,
  getValueSuggestions,
  useAdhocFilterOptions,
} from '@/components/AdhocDashboardFilter/useAdhocFilterOptions';
import {
  useMultipleAllFields,
  useMultipleGetKeyValues,
} from '@/hooks/useMetadata';
import {
  fetchPromqlLabelNames,
  fetchPromqlLabelValues,
} from '@/hooks/usePromqlMetadata';

let mockSources: Partial<TSource>[] = [];

jest.mock('@/source', () => ({
  useSources: () => ({ data: mockSources }),
}));
jest.mock('@/queryAttribution', () => ({
  useMetadataQueryAttribution: () => undefined,
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn(),
  useMultipleGetKeyValues: jest.fn(() => ({
    data: undefined,
    isFetching: false,
    isError: false,
  })),
}));
jest.mock('@/hooks/usePromqlMetadata', () => ({
  ...jest.requireActual('@/hooks/usePromqlMetadata'),
  fetchPromqlLabelNames: jest.fn(),
  fetchPromqlLabelValues: jest.fn(),
}));

const column = (name: string, type: string): ColumnMeta => ({
  name,
  type,
  codec_expression: '',
  comment: '',
  default_expression: '',
  default_type: '',
  ttl_expression: '',
});

describe('getSqlSourceKeys', () => {
  it('offers scalar columns and the keys inside map and JSON columns, not the whole columns', () => {
    expect(
      getSqlSourceKeys(
        [
          { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
          { path: ['LogAttributes'], type: 'Map', jsType: JSDataType.Map },
          { path: ['LogAttributes', '1'], type: 'String', jsType: null },
          { path: ['Body'], type: 'JSON', jsType: JSDataType.JSON },
          { path: ['Body', 'user.id'], type: 'String', jsType: null },
        ],
        [
          column('ServiceName', 'LowCardinality(String)'),
          column('LogAttributes', 'Map(LowCardinality(String), String)'),
          column('Body', 'JSON'),
        ],
      ),
    ).toEqual(['ServiceName', "LogAttributes['1']", 'Body.`user`.`id`']);
  });

  it('leaves out DateTime keys, whose values never match toString()', () => {
    expect(
      getSqlSourceKeys(
        [
          {
            path: ['Timestamp'],
            type: 'DateTime64(9)',
            jsType: JSDataType.Date,
          },
          { path: ['Day'], type: 'Date', jsType: JSDataType.Date },
          { path: ['Body', 'ts'], type: 'DateTime', jsType: JSDataType.Date },
        ],
        [
          column('Timestamp', 'DateTime64(9)'),
          column('Day', 'Date'),
          column('Body', 'JSON'),
        ],
      ),
    ).toEqual(['Day']);
  });

  it('keeps DateTime keys when the caller asks for every type', () => {
    expect(
      getSqlSourceKeys(
        [
          {
            path: ['Timestamp'],
            type: 'DateTime64(9)',
            jsType: JSDataType.Date,
          },
        ],
        [column('Timestamp', 'DateTime64(9)')],
        () => true,
      ),
    ).toEqual(['Timestamp']);
  });
});

describe('getSqlSourceColumnKeys', () => {
  it('offers only the scalar columns', () => {
    expect(
      getSqlSourceColumnKeys([
        column('ServiceName', 'LowCardinality(String)'),
        column('LogAttributes', 'Map(LowCardinality(String), String)'),
      ]),
    ).toEqual(['ServiceName']);
  });

  it('leaves out DateTime columns', () => {
    expect(
      getSqlSourceColumnKeys([
        column('Timestamp', "DateTime64(9, 'UTC')"),
        column('Day', 'Date'),
      ]),
    ).toEqual(['Day']);
  });

  it('quotes column names that are not bare identifiers', () => {
    expect(getSqlSourceColumnKeys([column('service-name', 'String')])).toEqual([
      '`service-name`',
    ]);
  });
});

describe('getValueSuggestions', () => {
  it('deduplicates scalar values and leaves out map and JSON values', () => {
    const mapValue = JSON.parse('{"service.name":"api"}');
    expect(
      getValueSuggestions([
        { key: 'ResourceAttributes', value: [mapValue, 'b', 'a'] },
        { key: 'ResourceAttributes', value: ['a', JSON.parse('null')] },
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('getSourcesWithKey', () => {
  const sources = [{ id: 'logs' }, { id: 'traces' }];

  it('looks up a key no source is known to have in every source', () => {
    expect(
      getSourcesWithKey(sources, new Map([['logs', ['ServiceName']]]), 'typed'),
    ).toEqual(sources);
  });
});

describe('useAdhocFilterOptions', () => {
  const DATE_RANGE: [Date, Date] = [
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T01:00:00Z'),
  ];
  const source = (id: string, kind: SourceKind): Partial<TSource> => ({
    id,
    kind,
    connection: 'conn',
    from: { databaseName: 'default', tableName: id },
    timestampValueExpression: 'Timestamp',
  });
  const filter = (
    sourceType: AdhocDashboardFilter['sourceType'],
    sources: string[],
  ): AdhocDashboardFilter => ({
    id: 'f',
    type: 'ADHOC',
    name: 'Conditions',
    sourceType,
    sources,
    isVariableEnabled: true,
  });

  /** `useMultipleAllFields` with the given columns per source, by index. */
  const mockAllFields = (
    columnsBySource: ColumnMeta[][],
    { isLoading = false } = {},
  ) =>
    jest.mocked(useMultipleAllFields).mockReturnValue({
      fieldsByTableConnection: new Map(),
      columnsByTableConnection: new Map(columnsBySource.entries()),
      isFieldMetadataDisabled: true,
      isLoading,
      isError: false,
    } as unknown as ReturnType<typeof useMultipleAllFields>);

  const renderOptions = (
    adhocFilter: AdhocDashboardFilter,
    key = 'SeverityText',
  ) => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(
      () => useAdhocFilterOptions(adhocFilter, key, DATE_RANGE),
      { wrapper },
    );
  };

  beforeEach(() => {
    mockAllFields([]);
    jest.mocked(fetchPromqlLabelNames).mockResolvedValue([]);
    jest.mocked(fetchPromqlLabelValues).mockResolvedValue([]);
  });

  const lastSqlLookup = () =>
    jest.mocked(useMultipleGetKeyValues).mock.calls.at(-1)!;

  it('waits for keys, then looks up values only in the sources that have the key', () => {
    mockSources = [
      source('logs', SourceKind.Log),
      source('traces', SourceKind.Trace),
    ];
    mockAllFields([], { isLoading: true });
    const { result, rerender } = renderOptions(
      filter('sql', ['logs', 'traces']),
    );

    expect(lastSqlLookup()[0].keys).toEqual([]);
    expect(result.current.values.isLoading).toBe(true);

    mockAllFields([
      [column('SeverityText', 'LowCardinality(String)')],
      [column('SpanName', 'LowCardinality(String)')],
    ]);
    rerender();

    expect(result.current.keys.data).toEqual(['SeverityText', 'SpanName']);
    const [{ chartConfigs, keys }] = lastSqlLookup();
    expect(keys).toEqual(['SeverityText']);
    expect(chartConfigs).toEqual([expect.objectContaining({ source: 'logs' })]);
  });

  it('quotes a map column name that is not a bare identifier', () => {
    mockSources = [source('logs', SourceKind.Log)];
    mockAllFields([[column('log-attributes', 'Map(String, String)')]]);
    renderOptions(filter('sql', ['logs']), "log-attributes['service']");

    expect(lastSqlLookup()[0].keys).toEqual(["`log-attributes`['service']"]);
  });

  it('leaves the SQL lookup disabled for a PromQL filter', async () => {
    mockSources = [source('prom', SourceKind.Promql)];
    jest
      .mocked(fetchPromqlLabelNames)
      .mockResolvedValue(['__name__', 'SeverityText']);
    const { result } = renderOptions(filter('promql', ['prom']));

    await waitFor(() =>
      expect(result.current.keys.data).toEqual(['SeverityText']),
    );
    expect(lastSqlLookup()[1]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    await waitFor(() =>
      expect(fetchPromqlLabelValues).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'SeverityText', sourceId: 'prom' }),
      ),
    );
  });
});
