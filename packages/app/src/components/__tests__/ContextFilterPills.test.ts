import { TSource } from '@hyperdx/common-utils/dist/types';

import {
  extractQuickFilters,
  getAvailablePresets,
  getPresetFilterIds,
  QuickFilterItem,
} from '@/components/ContextFilterPills';
import { ROW_DATA_ALIASES } from '@/components/DBRowDataPanel';

const makeLogSource = (overrides = {}): TSource =>
  ({
    id: 'src-1',
    kind: 'log',
    name: 'Test Logs',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    connection: 'conn-1',
    timestampValueExpression: 'Timestamp',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    eventAttributesExpression: 'LogAttributes',
    defaultTableSelectExpression: '*',
    ...overrides,
  }) as unknown as TSource;

describe('extractQuickFilters', () => {
  it('creates a service pill from serviceNameExpression', () => {
    const rowData = {
      [ROW_DATA_ALIASES.SERVICE_NAME]: 'my-service',
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {},
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource();
    const filters = extractQuickFilters(rowData, source);

    const svcFilter = filters.find(f => f.id === 'svc');
    expect(svcFilter).toBeDefined();
    expect(svcFilter!.label).toBe('ServiceName');
    expect(svcFilter!.value).toBe('my-service');
  });

  it('falls back to resource attribute service.name when no serviceNameExpression', () => {
    const rowData = {
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {
        'service.name': 'api-gateway',
      },
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource({ serviceNameExpression: undefined });
    const filters = extractQuickFilters(rowData, source);

    const svcFilter = filters.find(f => f.id === 'ra:service.name');
    expect(svcFilter).toBeDefined();
    expect(svcFilter!.value).toBe('api-gateway');
  });

  it('promotes host.name, k8s.pod.name, k8s.namespace.name, k8s.node.name', () => {
    const rowData = {
      [ROW_DATA_ALIASES.SERVICE_NAME]: 'svc',
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {
        'host.name': 'host-1',
        'k8s.pod.name': 'pod-abc',
        'k8s.namespace.name': 'default',
        'k8s.node.name': 'node-1',
        'other.attr': 'value',
      },
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource();
    const filters = extractQuickFilters(rowData, source);
    const ids = filters.map(f => f.id);

    expect(ids.indexOf('ra:host.name')).toBeLessThan(
      ids.indexOf('ra:other.attr'),
    );
    expect(ids.indexOf('ra:k8s.pod.name')).toBeLessThan(
      ids.indexOf('ra:other.attr'),
    );
  });

  it('includes event attributes', () => {
    const rowData = {
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {},
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {
        'http.method': 'GET',
        'http.url': '/api/health',
      },
    };
    const source = makeLogSource({ serviceNameExpression: undefined });
    const filters = extractQuickFilters(rowData, source);

    expect(filters.find(f => f.id === 'ea:http.method')).toBeDefined();
    expect(filters.find(f => f.id === 'ea:http.url')).toBeDefined();
  });

  it('includes top-level columns as col: filters', () => {
    const rowData = {
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {},
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
      SeverityText: 'ERROR',
      ScopeName: 'my-scope',
    };
    const source = makeLogSource({ serviceNameExpression: undefined });
    const filters = extractQuickFilters(rowData, source);

    expect(filters.find(f => f.id === 'col:SeverityText')).toBeDefined();
    expect(filters.find(f => f.id === 'col:ScopeName')).toBeDefined();
  });

  it('skips timestamp-like columns and __hdx_ aliases', () => {
    const rowData = {
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.BODY]: 'test body',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: {},
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
      TimestampTime: '2024-01-01',
      EventTimeTTL: '2024-01-01',
      __hdx_custom: 'hidden',
    };
    const source = makeLogSource({ serviceNameExpression: undefined });
    const filters = extractQuickFilters(rowData, source);

    expect(filters.find(f => f.label === 'TimestampTime')).toBeUndefined();
    expect(filters.find(f => f.label === 'EventTimeTTL')).toBeUndefined();
    expect(filters.find(f => f.label === '__hdx_custom')).toBeUndefined();
    expect(filters.find(f => f.label === '__hdx_body')).toBeUndefined();
  });

  it('skips values longer than 200 characters', () => {
    const longValue = 'a'.repeat(201);
    const rowData = {
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: { longkey: longValue },
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource({ serviceNameExpression: undefined });
    const filters = extractQuickFilters(rowData, source);

    expect(filters.find(f => f.id === 'ra:longkey')).toBeUndefined();
  });

  it('generates correct SQL WHERE clauses', () => {
    const rowData = {
      [ROW_DATA_ALIASES.SERVICE_NAME]: "O'Brien",
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: { 'host.name': 'host-1' },
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource();
    const filters = extractQuickFilters(rowData, source);

    const svcFilter = filters.find(f => f.id === 'svc')!;
    expect(svcFilter.generateWhere(true)).toBe("ServiceName = 'O''Brien'");

    const hostFilter = filters.find(f => f.id === 'ra:host.name')!;
    expect(hostFilter.generateWhere(true)).toBe(
      "ResourceAttributes['host.name']='host-1'",
    );
  });

  it('generates correct Lucene WHERE clauses', () => {
    const rowData = {
      [ROW_DATA_ALIASES.SERVICE_NAME]: 'my-svc',
      [ROW_DATA_ALIASES.TIMESTAMP]: '2024-01-01T00:00:00Z',
      [ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]: { 'host.name': 'host-1' },
      [ROW_DATA_ALIASES.EVENT_ATTRIBUTES]: {},
    };
    const source = makeLogSource();
    const filters = extractQuickFilters(rowData, source);

    const svcFilter = filters.find(f => f.id === 'svc')!;
    expect(svcFilter.generateWhere(false)).toBe('ServiceName:"my-svc"');

    const hostFilter = filters.find(f => f.id === 'ra:host.name')!;
    expect(hostFilter.generateWhere(false)).toBe(
      'ResourceAttributes.host.name:"host-1"',
    );
  });
});

describe('getPresetFilterIds', () => {
  const available: QuickFilterItem[] = [
    { id: 'svc', label: 'ServiceName', value: 'api', generateWhere: () => '' },
    {
      id: 'ra:host.name',
      label: 'host.name',
      value: 'h1',
      generateWhere: () => '',
    },
    {
      id: 'ra:k8s.pod.name',
      label: 'k8s.pod.name',
      value: 'pod-1',
      generateWhere: () => '',
    },
    {
      id: 'ra:k8s.namespace.name',
      label: 'k8s.namespace.name',
      value: 'ns',
      generateWhere: () => '',
    },
    {
      id: 'ra:k8s.node.name',
      label: 'k8s.node.name',
      value: 'node-1',
      generateWhere: () => '',
    },
  ];

  it('returns service IDs for "service" preset', () => {
    expect(getPresetFilterIds('service', available)).toEqual(['svc']);
  });

  it('returns service + host IDs for "host" preset', () => {
    expect(getPresetFilterIds('host', available)).toEqual([
      'svc',
      'ra:host.name',
    ]);
  });

  it('returns service + pod + namespace IDs for "pod" preset', () => {
    expect(getPresetFilterIds('pod', available)).toEqual([
      'svc',
      'ra:k8s.pod.name',
      'ra:k8s.namespace.name',
    ]);
  });

  it('returns service + node IDs for "node" preset', () => {
    expect(getPresetFilterIds('node', available)).toEqual([
      'svc',
      'ra:k8s.node.name',
    ]);
  });

  it('returns empty for unknown preset', () => {
    expect(getPresetFilterIds('unknown', available)).toEqual([]);
  });

  it('only returns IDs that exist in available filters', () => {
    const limited: QuickFilterItem[] = [
      {
        id: 'ra:host.name',
        label: 'host.name',
        value: 'h1',
        generateWhere: () => '',
      },
    ];
    expect(getPresetFilterIds('host', limited)).toEqual(['ra:host.name']);
  });
});

describe('getAvailablePresets', () => {
  it('always includes Anything and Custom', () => {
    const presets = getAvailablePresets([]);
    expect(presets.map(p => p.value)).toContain('all');
    expect(presets.map(p => p.value)).toContain('custom');
    expect(presets.find(p => p.value === 'all')!.label).toBe('Anything');
  });

  it('includes Service when svc filter exists', () => {
    const available: QuickFilterItem[] = [
      {
        id: 'svc',
        label: 'ServiceName',
        value: 'api',
        generateWhere: () => '',
      },
    ];
    const presets = getAvailablePresets(available);
    expect(presets.map(p => p.value)).toContain('service');
  });

  it('includes Pod when k8s.pod.name filter exists', () => {
    const available: QuickFilterItem[] = [
      {
        id: 'ra:k8s.pod.name',
        label: 'k8s.pod.name',
        value: 'pod-1',
        generateWhere: () => '',
      },
    ];
    const presets = getAvailablePresets(available);
    expect(presets.map(p => p.value)).toContain('pod');
  });

  it('does not include Host when host.name is absent', () => {
    const available: QuickFilterItem[] = [
      {
        id: 'svc',
        label: 'ServiceName',
        value: 'api',
        generateWhere: () => '',
      },
    ];
    const presets = getAvailablePresets(available);
    expect(presets.map(p => p.value)).not.toContain('host');
  });
});
