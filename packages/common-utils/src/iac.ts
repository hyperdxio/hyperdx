import { AlertSource, type IacImportManifest } from './types';

//
// Single source of truth for everything HyperDX asserts about the ClickHouse
// Terraform provider (github.com/ClickHouse/terraform-provider-clickhouse).
// When the provider changes, this file and its tests are the only places to
// update.
//
// Framework-free and dependency-free on purpose: it lives here rather than in
// packages/app so the API (and anything agent-facing built on it) can produce
// the same artefact a human gets from the UI.

const TERRAFORM_PROVIDER_SOURCE = 'ClickHouse/clickhouse';
// First provider version shipping the ClickStack (HyperDX) resources.
const TERRAFORM_PROVIDER_VERSION_CONSTRAINT = '>= 3.22.0';
// `import {}` blocks and `-generate-config-out` both landed in Terraform 1.5.
// Without this, an older CLI fails with a syntax error instead of saying so.
const TERRAFORM_VERSION_CONSTRAINT = '>= 1.5.0';

// Per-type ceiling the manifest endpoint applies to each listing. Shared so
// the server that enforces it and the UI copy that explains it cannot drift.
export const IAC_MANIFEST_LIMIT = 1000;

export type IacResourceType =
  | 'dashboard'
  | 'alert'
  | 'saved_search'
  | 'source'
  | 'connection'
  | 'webhook';

export const TERRAFORM_RESOURCE_TYPES: Record<IacResourceType, string> = {
  dashboard: 'clickhouse_clickstack_dashboard',
  alert: 'clickhouse_clickstack_alert',
  saved_search: 'clickhouse_clickstack_saved_search',
  source: 'clickhouse_clickstack_source',
  connection: 'clickhouse_clickstack_connection',
  webhook: 'clickhouse_clickstack_webhook',
};

export type IacResourceRef = {
  type: IacResourceType;
  id: string;
  name?: string;
};

// The manifest contract lives in ./types so this module and the router that
// serves it (packages/api/src/routers/api/iac.ts) cannot drift.
export type { IacImportManifest };

// `name` is optional throughout: it is a plain (non-required) String on the
// Connection/Source/SavedSearch schemas, so the manifest can legitimately
// carry an entry without one.
export type IacConnectionRef = IacImportManifest['connections'][number];

/**
 * The provider models only saved-search alerts — a tile alert has no
 * corresponding resource, so offering one for import produces a command that
 * fails. Shared by the bulk export and the per-alert popover so the two cannot
 * disagree about what is eligible.
 */
export function isImportableAlert(alert: {
  source?: string;
  savedSearchId?: string;
}): boolean {
  // `source` is authoritative whenever it is set. The savedSearchId fallback
  // covers only legacy rows that predate the discriminator — it must NOT be an
  // unconditional `||`, because converting a saved-search alert to a tile alert
  // leaves the old savedSearch reference behind: `makeAlert` passes
  // `savedSearch: undefined` and Mongoose 6 deletes undefined keys from the
  // `$set` instead of clearing the field. A tile alert can therefore still
  // report a savedSearchId, and the provider cannot model it.
  return (
    alert.source === AlertSource.SAVED_SEARCH ||
    (alert.source == null && !!alert.savedSearchId)
  );
}

/**
 * Provisioned dashboards are machine-managed by ProvisionDashboardsTask, whose
 * name-keyed upsert overwrites tiles, tags, and filters wholesale — two
 * managers for one object is a fight nobody wins. The bulk manifest filters
 * them out server-side (`provisioned: { $ne: true }`); this is the same rule
 * for the per-dashboard surface, so the two cannot disagree.
 */
export function isImportableDashboard(dashboard: {
  provisioned?: boolean;
}): boolean {
  return !dashboard.provisioned;
}

/**
 * Terraform addresses are derived from the id, never the name.
 *
 * A name-derived address changes when someone renames the resource in HyperDX,
 * and re-exporting then emits a new address for an object Terraform already
 * tracks — which it plans as a destroy of the old one. Ids are immutable and
 * unique, so `<type>_<id>` is both stable across renames and collision-free
 * between two same-type resources that share a name. The human-readable name
 * goes in a comment above each block instead.
 *
 * ObjectIds are 24 hex characters and can start with a digit, which Terraform
 * rejects as an identifier; the type prefix covers that. The character filter
 * is belt-and-braces — ids reaching here are always ObjectId hex.
 */
export function terraformResourceLabel({ type, id }: IacResourceRef): string {
  return `${type}_${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Names are user-controlled and land in generated HCL, so a newline would end
 * the comment and let the rest of the name become a directive. Collapse all
 * whitespace, drop the other control characters, and cap the length.
 */
function commentSafeName(name: string | undefined): string | undefined {
  // \s covers the line terminators; the explicit range covers the remaining
  // C0 controls and DEL, which \s does not.
  // eslint-disable-next-line no-control-regex
  const safe = name?.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  return safe ? safe.slice(0, 120) : undefined;
}

export function buildImportBlock(ref: IacResourceRef): string {
  const name = commentSafeName(ref.name);
  return `${name ? `# ${name}\n` : ''}import {
  to = ${TERRAFORM_RESOURCE_TYPES[ref.type]}.${terraformResourceLabel(ref)}
  id = "${ref.id}"
}`;
}

export function buildProviderBlock(endpoint: string): string {
  return `terraform {
  required_version = "${TERRAFORM_VERSION_CONSTRAINT}"
  required_providers {
    clickhouse = {
      source  = "${TERRAFORM_PROVIDER_SOURCE}"
      version = "${TERRAFORM_PROVIDER_VERSION_CONSTRAINT}"
    }
  }
}

provider "clickhouse" {
  clickstack_endpoint = "${endpoint}"
  # Set the CLICKSTACK_API_KEY environment variable to your Personal API
  # Access Key (Team Settings -> API & Agents). Avoid committing keys.
}`;
}

// Connections whose provenance is unknown, or which the server marks as
// platform-provisioned, are exposed as reference-only locals: on ClickHouse
// Cloud the provider cannot manage them. Only a connection the server marks
// explicitly self-managed becomes an import block instead.
function buildConnectionLocalsBlock(connections: IacConnectionRef[]): string {
  const lines = connections.flatMap(c => {
    const name = commentSafeName(c.name);
    const label = terraformResourceLabel({ type: 'connection', id: c.id });
    return [...(name ? [`  # ${name}`] : []), `  ${label}_id = "${c.id}"`];
  });
  return `# These connections are either platform-provisioned or of unrecorded
# provenance, so Terraform cannot manage them. Reference them by id instead.
locals {
${lines.join('\n')}
}`;
}

export function buildImportFile({
  endpoint,
  resources,
  connectionLocals = [],
}: {
  endpoint: string;
  resources: IacResourceRef[];
  connectionLocals?: IacConnectionRef[];
}): string {
  const sections = [
    buildProviderBlock(endpoint),
    ...(connectionLocals.length
      ? [buildConnectionLocalsBlock(connectionLocals)]
      : []),
    ...resources.map(buildImportBlock),
  ];
  return `# HyperDX Terraform import file
# Generated by HyperDX. Review before committing to your repository.
#
# 1. Place this file in your Terraform project.
#    If your project already declares the ClickHouse provider, delete the
#    "terraform" and "provider" blocks below — Terraform allows only one of
#    each per module.
# 2. export CLICKSTACK_API_KEY=<your Personal API Access Key>
# 3. terraform init          # installs the ClickHouse provider declared above
# 4. terraform plan -generate-config-out=generated.tf
# 5. Review generated.tf carefully, then: terraform apply
#
# Before you apply:
#
# * Review generated.tf against the real resource. The provider's ClickStack
#   resources are alpha and do not model every HyperDX feature — PromQL tiles
#   in particular have no representation. A dashboard's configuration is
#   written back whole, so applying a config that omits something deletes it.
# * Resource addresses below are derived from each resource's id, so they
#   survive a rename in HyperDX. The name in the comment above each block is
#   a label for humans only.
# * ClickStack resources in the provider are in alpha; behaviour may change
#   between provider versions.

${sections.join('\n\n')}
`;
}

export function collectImportableResources(
  manifest: IacImportManifest,
  selectedTypes: IacResourceType[],
): {
  resources: IacResourceRef[];
  connectionLocals: IacConnectionRef[];
  skippedAlerts: number;
} {
  const resources: IacResourceRef[] = [];
  let skippedAlerts = 0;

  // Dispatched explicitly rather than looping a {type, key} table. The table
  // form could not tie a resource type to its manifest key, so a mispaired
  // entry compiled fine and needed an `as` cast to read alert-only fields —
  // between them that silently dropped resources and miscounted skips.
  const add = (
    type: IacResourceType,
    items: { id: string; name?: string }[],
  ) => {
    if (!selectedTypes.includes(type)) return;
    for (const item of items) {
      resources.push({ type, id: item.id, name: item.name });
    }
  };

  add('source', manifest.sources);
  add('saved_search', manifest.savedSearches);
  add('webhook', manifest.webhooks);

  if (selectedTypes.includes('alert')) {
    for (const alert of manifest.alerts) {
      if (!isImportableAlert(alert)) {
        skippedAlerts += 1;
        continue;
      }
      resources.push({ type: 'alert', id: alert.id, name: alert.name });
    }
  }

  add('dashboard', manifest.dashboards);

  // A connection is only safe to import when the server affirmatively says it
  // is self-managed. Platform-provisioned connections (ClickHouse Cloud) can't
  // be managed by the provider, and `undefined` means nobody has recorded the
  // provenance — so both fall back to reference-only locals.
  //
  // The safe floor is deliberate. No client-side signal distinguishes Cloud
  // from self-hosted: IS_CLICKHOUSE_BUILD marks the bundled ClickStack
  // distribution (itself self-hosted), and an origin/domain check breaks on
  // custom domains and misreads the public `*.clickhouse.com` demo servers.
  // Only the server knows, via Connection.platformProvisioned.
  //
  // Nothing populates that field yet, so today every connection takes the
  // locals path — the same behaviour as before it existed.
  const connectionsSelected = selectedTypes.includes('connection');
  const connectionLocals: IacConnectionRef[] = [];
  if (connectionsSelected) {
    for (const c of manifest.connections) {
      if (c.platformProvisioned === false) {
        resources.push({ type: 'connection', id: c.id, name: c.name });
      } else {
        connectionLocals.push(c);
      }
    }
  }

  return { resources, connectionLocals, skippedAlerts };
}
