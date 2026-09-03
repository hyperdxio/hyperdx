import {
  isImportableAlert,
  isImportableDashboard,
  isImportableSource,
} from './iacEligibility';
import { AlertSource, type IacImportManifest } from './types';

// Re-exported so callers keep one import site (`@hyperdx/common-utils/dist/iac`)
// for both halves of the feature.
export {
  dashboardHasUnexportableTiles,
  isAddressableTile,
  isImportableAlert,
  isImportableDashboard,
  isImportableSource,
  isTileAlertUnaddressable,
  isUnexportableTile,
} from './iacEligibility';

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
// The floor is about dashboards, not about the id form: below it, importing a
// dashboard carries server-only ids into the config `-generate-config-out`
// writes, and applying that config is what churns tile ids and takes the tile
// alerts with them (provider #654, released in 3.24.1; 3.25.0 is the version
// we pin). The `<team_id>/<resource_id>` id we emit has been accepted since
// 3.22.0 and does not need this floor.
const TERRAFORM_PROVIDER_VERSION_CONSTRAINT = '>= 3.25.0';
// `source = "tile"` with `dashboard_id`/`tile_id` on
// clickhouse_clickstack_alert, and the `tile_ids` map on
// clickhouse_clickstack_dashboard, arrive in 3.26.0 (provider #683). Only a
// file that actually carries a tile alert asks for it — an export of anything
// else still installs on 3.25.x, and raising the floor for everyone would
// break those exports for no reason.
// Exported: the per-alert popover names it in its copy, and a second literal
// there would drift the moment this one moves.
export const TERRAFORM_PROVIDER_TILE_ALERT_VERSION_CONSTRAINT = '>= 3.26.0';
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
  /**
   * Set on an alert that watches a dashboard tile. It only decides which
   * provider version the file asks for — the address and the import id of a
   * tile alert are the same as any other alert's.
   */
  tileAlert?: boolean;
};

// The manifest contract lives in ./types so this module and the router that
// serves it (packages/api/src/routers/api/iac.ts) cannot drift.
export type { IacImportManifest };

// `name` is optional throughout: it is a plain (non-required) String on the
// Connection/Source/SavedSearch schemas, so the manifest can legitimately
// carry an entry without one.
export type IacConnectionRef = IacImportManifest['connections'][number];

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

/** ObjectId hex — the only id shape any HyperDX resource has. */
export const IAC_RESOURCE_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * `id` is the one manifest value that reaches executable HCL unescaped, inside
 * a double-quoted string where a `"` would terminate the literal. `name` is
 * confined to a comment and the label is filtered to `[a-z0-9_]`, so this is
 * the remaining sink — and `IacManifestEntrySchema` types it as a plain string,
 * which is not a constraint. Throwing rather than sanitising: an id that is not
 * ObjectId hex means the caller is wrong about what it is holding, and a
 * silently rewritten id would import the wrong resource.
 */
function assertResourceId(id: string, label = 'id'): string {
  if (!IAC_RESOURCE_ID_RE.test(id)) {
    throw new Error(
      `Refusing to emit Terraform for a non-ObjectId ${label}: ${id}`,
    );
  }
  return id;
}

/**
 * Import ids are `<team_id>/<resource_id>`. On ClickHouse Cloud one ClickStack
 * service can back several teams, so a bare resource id does not say which
 * team's resource to read. The team stays out of the Terraform address (see
 * terraformResourceLabel) — it belongs to the lookup, not the identity.
 */
export function buildImportBlock(ref: IacResourceRef, teamId: string): string {
  const name = commentSafeName(ref.name);
  return `${name ? `# ${name}\n` : ''}import {
  to = ${TERRAFORM_RESOURCE_TYPES[ref.type]}.${terraformResourceLabel(ref)}
  id = "${assertResourceId(teamId, 'team id')}/${assertResourceId(ref.id, 'resource id')}"
}`;
}

/**
 * The provider endpoint both surfaces emit. Shared because they had drifted:
 * the popover used the bare origin while the bulk export added the deployment
 * path prefix, so on any deployment with a prefix set one of the two produced
 * an endpoint that could not reach the API.
 */
export function providerEndpoint(origin: string, basePath = ''): string {
  return `${origin}${basePath}/api`;
}

/** The higher of the two floors that applies to what the file contains. */
function providerVersionConstraint(tileAlerts: boolean): string {
  return tileAlerts
    ? TERRAFORM_PROVIDER_TILE_ALERT_VERSION_CONSTRAINT
    : TERRAFORM_PROVIDER_VERSION_CONSTRAINT;
}

/**
 * The endpoint is emitted as a variable rather than a baked literal. The
 * default is derived from the browser that generated the file, and that is a
 * guess twice over: it drops any deployment path prefix, and Terraform often
 * runs somewhere the browser's origin does not resolve at all (CI, a laptop on
 * a different network, localhost). A variable makes it overridable without
 * editing generated HCL, and the header tells the user to check it.
 */
export function buildProviderBlock(
  endpoint: string,
  { tileAlerts = false }: { tileAlerts?: boolean } = {},
): string {
  return `terraform {
  required_version = "${TERRAFORM_VERSION_CONSTRAINT}"
  required_providers {
    clickhouse = {
      source  = "${TERRAFORM_PROVIDER_SOURCE}"
      version = "${providerVersionConstraint(tileAlerts)}"
    }
  }
}

variable "clickstack_endpoint" {
  description = "ClickStack API endpoint. Defaulted from the browser that generated this file — override if Terraform runs somewhere that origin does not resolve, or if your deployment is served under a path prefix."
  type        = string
  default     = "${endpoint}"
}

provider "clickhouse" {
  clickstack_endpoint = var.clickstack_endpoint
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
    return [
      ...(name ? [`  # ${name}`] : []),
      `  ${label}_id = "${assertResourceId(c.id)}"`,
    ];
  });
  return `# These connections are either platform-provisioned or of unrecorded
# provenance, so Terraform cannot manage them. Reference them by id instead.
locals {
${lines.join('\n')}
}`;
}

export function buildImportFile({
  endpoint,
  teamId,
  resources,
  connectionLocals = [],
  truncatedTypes = [],
  skipNotices = [],
}: {
  endpoint: string;
  /** Prefixes every import id — see buildImportBlock. */
  teamId: string;
  resources: IacResourceRef[];
  connectionLocals?: IacConnectionRef[];
  /**
   * Human-readable names of the listings the server capped. Recorded in the
   * generated file, not just the UI: the `.tf` is what gets committed and read
   * months later, and a partial export that says nothing looks like a complete
   * one.
   */
  truncatedTypes?: string[];
  /**
   * Reasons resources were withheld as ineligible, one line each. Same argument
   * as truncatedTypes — the file has to say why it is smaller than the team.
   */
  skipNotices?: string[];
}): string {
  // Derived from the resources rather than taken as a parameter: a call site
  // that forgot to pass it would emit a file that installs a provider with no
  // `source = "tile"`, and the failure would land at plan time.
  const tileAlerts = resources.some(r => r.tileAlert);
  const sections = [
    buildProviderBlock(endpoint, { tileAlerts }),
    ...(connectionLocals.length
      ? [buildConnectionLocalsBlock(connectionLocals)]
      : []),
    ...resources.map(r => buildImportBlock(r, teamId)),
  ];
  const partialWarning = truncatedTypes.length
    ? `#
# ! PARTIAL EXPORT. These resource types had more than ${IAC_MANIFEST_LIMIT}
#   entries and were capped, so this file covers only the first
#   ${IAC_MANIFEST_LIMIT} of each: ${truncatedTypes.join(', ')}.
#   The remainder is not in this file and re-exporting returns the same page.
`
    : '';
  // Tile alerts are the one resource whose generated config needs a hand edit
  // to be durable, so the file says so where the user will read it.
  const tileAlertNotice = tileAlerts
    ? `# * Tile alerts in this file need provider ${TERRAFORM_PROVIDER_TILE_ALERT_VERSION_CONSTRAINT},
#   where clickhouse_clickstack_alert gained source = "tile". The generated
#   config pins dashboard_id and tile_id as literals; if the dashboard is in
#   this file too, replace them with references —
#   clickhouse_clickstack_dashboard.<name>.id and
#   ...tile_ids["<tile name>"] — before you commit. Tile ids are
#   server-assigned, so a literal one goes stale the next time the dashboard is
#   applied, and the alert is deleted with the tile it pointed at. Renaming an
#   alerted tile also mints a new id, which fails the plan until the reference
#   is updated.
`
    : '';
  const skipped = skipNotices.length
    ? `#
# Some resources were left out as ineligible:
${skipNotices.map(n => `#   - ${n}`).join('\n')}
`
    : '';
  return `# HyperDX Terraform import file
# Generated by HyperDX. Review before committing to your repository.
${partialWarning}${skipped}#
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
# * Check the clickstack_endpoint default above. It comes from the browser that
#   generated this file, so it may not resolve from wherever Terraform runs.
# * Resource addresses below are derived from each resource's id, so they
#   survive a rename in HyperDX. The name in the comment above each block is
#   a label for humans only.
# * Import ids are "<team_id>/<resource_id>", so each imported resource gets a
#   "team" attribute. Keep it in generated.tf: the provider marks that
#   attribute RequiresReplace, so removing or changing it plans a destroy and
#   recreate rather than an update.
# * Team-scoped ids need the provider configured with clickstack_endpoint, as
#   the block below does. A provider configured against the Cloud API instead
#   (clickstack_service_id) rejects any team-scoped call — on that path a
#   service is a single ClickStack, so drop the "<team_id>/" prefix.
# * The provider version constraint below is a floor, not decoration. If you
#   delete the "terraform" block per step 1, check your own declaration
#   requires ${providerVersionConstraint(tileAlerts)} — older providers write
#   server-only ids into the config generated for a dashboard, and applying
#   that churns its tile ids and deletes the tile alerts attached to them.
${tileAlertNotice}# * Re-exporting later does NOT produce an additive file. It re-emits every
#   resource, including the ones already in state, so two of these files in one
#   module means duplicate "to" addresses — which Terraform rejects for the
#   whole plan, not just the clashing blocks. Delete the previous file, or the
#   blocks for anything already imported, before adding a new one.
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
  skippedDashboards: number;
  skippedSources: number;
} {
  const resources: IacResourceRef[] = [];
  let skippedAlerts = 0;
  let skippedDashboards = 0;
  let skippedSources = 0;

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

  if (selectedTypes.includes('source')) {
    for (const source of manifest.sources) {
      if (!isImportableSource(source)) {
        skippedSources += 1;
        continue;
      }
      resources.push({ type: 'source', id: source.id, name: source.name });
    }
  }

  add('saved_search', manifest.savedSearches);
  add('webhook', manifest.webhooks);

  if (selectedTypes.includes('alert')) {
    for (const alert of manifest.alerts) {
      if (!isImportableAlert(alert)) {
        skippedAlerts += 1;
        continue;
      }
      resources.push({
        type: 'alert',
        id: alert.id,
        name: alert.name,
        // Only set when true: the ref is compared structurally in tests and a
        // `false` on every other alert reads as a tri-state it is not.
        ...(alert.source === AlertSource.TILE ? { tileAlert: true } : {}),
      });
    }
  }

  // Not `add('dashboard', ...)`: a dashboard whose tiles the round trip would
  // destroy is skipped and counted, the same treatment tile alerts get.
  if (selectedTypes.includes('dashboard')) {
    for (const dashboard of manifest.dashboards) {
      if (!isImportableDashboard(dashboard)) {
        skippedDashboards += 1;
        continue;
      }
      resources.push({
        type: 'dashboard',
        id: dashboard.id,
        name: dashboard.name,
      });
    }
  }

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

  return {
    resources,
    connectionLocals,
    skippedAlerts,
    skippedDashboards,
    skippedSources,
  };
}
