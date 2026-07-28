import {
  buildImportCommand,
  buildImportFile,
  collectImportableResources,
  type IacImportManifest,
  terraformResourceLabel,
} from '@/components/Iac/terraformSnippets';

const ID = '655b1b7d9143aa1b1b73f4f4';

describe('terraformResourceLabel', () => {
  it('slugifies the name and appends an id suffix for uniqueness', () => {
    expect(
      terraformResourceLabel({
        type: 'dashboard',
        id: ID,
        name: 'HyperDX Usage!',
      }),
    ).toBe('hyperdx_usage_3f4f4');
  });

  it('falls back to the resource type when the name is missing', () => {
    expect(terraformResourceLabel({ type: 'alert', id: ID })).toBe(
      'alert_3f4f4',
    );
  });

  it('prefixes the type when the slug does not start with a letter', () => {
    expect(
      terraformResourceLabel({ type: 'dashboard', id: ID, name: '404 errors' }),
    ).toBe('dashboard_404_errors_3f4f4');
  });
});

describe('buildImportCommand', () => {
  it('emits the plain-id import form (never <teamId>/<id>)', () => {
    expect(
      buildImportCommand({ type: 'dashboard', id: ID, name: 'HyperDX Usage' }),
    ).toBe(
      `terraform import clickhouse_clickstack_dashboard.hyperdx_usage_3f4f4 ${ID}`,
    );
  });
});

describe('buildImportFile', () => {
  it('contains the provider block, import blocks, and generate-config instructions', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [
        { type: 'dashboard', id: ID, name: 'Usage' },
        {
          type: 'saved_search',
          id: 'a55b1b7d9143aa1b1b73f4f4',
          name: 'Errors',
        },
      ],
    });
    expect(file).toContain('source  = "ClickHouse/clickhouse"');
    expect(file).toContain('version = ">= 3.22.0"');
    expect(file).toContain(
      'clickstack_endpoint = "https://hyperdx.example.com/api"',
    );
    expect(file).toContain('CLICKSTACK_API_KEY');
    expect(file).toContain('to = clickhouse_clickstack_dashboard.usage_3f4f4');
    expect(file).toContain(`id = "${ID}"`);
    expect(file).toContain(
      'to = clickhouse_clickstack_saved_search.errors_3f4f4',
    );
    expect(file).toContain('terraform plan -generate-config-out=generated.tf');
    expect(file).not.toContain('locals'); // no connections selected
  });

  // Addresses are name-derived, so a rename changes the address and Terraform
  // reads that as destroy-and-recreate. The header has to say so.
  it('warns about renames, whole-body writes, and a duplicate provider block', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });
    expect(file).toMatch(
      /Renaming a resource .* produces a different\n# {3}address/s,
    );
    expect(file).toContain('moved');
    expect(file).toContain('written back whole');
    expect(file).toContain('delete the');
  });

  it('emits connections as a locals block, never as import blocks', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [],
      connectionLocals: [{ id: ID, name: 'Local ClickHouse' }],
    });
    expect(file).toContain('locals {');
    expect(file).toContain(`local_clickhouse_3f4f4_id = "${ID}"`);
    expect(file).not.toContain('clickhouse_clickstack_connection');
  });
});

describe('collectImportableResources', () => {
  const manifest: IacImportManifest = {
    dashboards: [{ id: '1'.repeat(24), name: 'D1' }],
    alerts: [
      {
        id: '2'.repeat(24),
        name: 'A1',
        source: 'saved_search',
        savedSearchId: '4'.repeat(24),
      },
      { id: '3'.repeat(24), name: 'A2 (tile)', source: 'tile' },
    ],
    savedSearches: [{ id: '4'.repeat(24), name: 'S1' }],
    sources: [],
    connections: [],
    webhooks: [],
  };

  it('only includes selected types and skips tile alerts with a count', () => {
    const { resources, connectionLocals, skippedTileAlerts } =
      collectImportableResources(manifest, ['dashboard', 'alert']);
    expect(resources).toEqual([
      { type: 'alert', id: '2'.repeat(24), name: 'A1' },
      { type: 'dashboard', id: '1'.repeat(24), name: 'D1' },
    ]);
    expect(connectionLocals).toEqual([]);
    expect(skippedTileAlerts).toBe(1);
  });

  const withConnections = {
    ...manifest,
    connections: [{ id: '6'.repeat(24), name: 'Local ClickHouse' }],
  };

  // Provenance is tri-state; only an explicit `false` licenses an import.
  it('treats a connection of unknown provenance as reference-only', () => {
    const { resources, connectionLocals } = collectImportableResources(
      withConnections,
      ['connection'],
    );
    expect(resources).toEqual([]);
    expect(connectionLocals).toEqual([
      { id: '6'.repeat(24), name: 'Local ClickHouse' },
    ]);
  });

  it('keeps a platform-provisioned connection reference-only', () => {
    const { resources, connectionLocals } = collectImportableResources(
      {
        ...manifest,
        connections: [
          { id: '6'.repeat(24), name: 'Cloud ClickHouse', provisioned: true },
        ],
      },
      ['connection'],
    );
    expect(resources).toEqual([]);
    expect(connectionLocals).toHaveLength(1);
  });

  it('imports a connection the server marks self-managed', () => {
    const { resources, connectionLocals } = collectImportableResources(
      {
        ...manifest,
        connections: [
          { id: '6'.repeat(24), name: 'Local ClickHouse', provisioned: false },
        ],
      },
      ['connection'],
    );
    expect(resources).toEqual([
      { type: 'connection', id: '6'.repeat(24), name: 'Local ClickHouse' },
    ]);
    expect(connectionLocals).toEqual([]);
  });

  it('emits neither when connections are not selected', () => {
    const { resources, connectionLocals } = collectImportableResources(
      withConnections,
      ['dashboard'],
    );
    expect(resources.some(r => r.type === 'connection')).toBe(false);
    expect(connectionLocals).toEqual([]);
  });
});
