import { AlertSource, DisplayType, SourceKind } from './types';

//
// Which resources the ClickHouse Terraform provider can actually take
// ownership of. Split out of ./iac.ts, which generates the HCL: these are the
// rules about *whether* to emit a resource, not how. Both the API and the app
// import them, so the bulk export and the per-resource popovers cannot
// disagree about what is eligible.

/**
 * The provider models saved-search alerts and — since 3.26.0 — dashboard tile
 * alerts. An inline alert carries its own chart config, which
 * `clickhouse_clickstack_alert` has no attributes for, so offering one produces
 * a command that fails. Shared by the bulk export and the per-alert popover so
 * the two cannot disagree about what is eligible.
 */
export function isImportableAlert(alert: {
  source?: string;
  savedSearchId?: string;
  /**
   * Tile alerts only, and server-computed — see isTileAlertUnaddressable.
   * Absent means addressable, so a response predating that check offers the
   * alert; the cost is an import whose reference needs a hand fix, which is
   * the lesser of the two failures during a rolling deploy.
   */
  unaddressableTile?: boolean;
}): boolean {
  if (alert.source === AlertSource.TILE) return !alert.unaddressableTile;
  // `source` is authoritative whenever it is set. The savedSearchId fallback
  // covers only legacy rows that predate the discriminator — it must NOT be an
  // unconditional `||`, because converting a saved-search alert to a tile alert
  // leaves the old savedSearch reference behind: `makeAlert` passes
  // `savedSearch: undefined` and Mongoose 6 deletes undefined keys from the
  // `$set` instead of clearing the field. A tile alert can therefore still
  // report a savedSearchId, and it must be judged by the tile rule above, not
  // waved through as a saved-search alert.
  return (
    alert.source === AlertSource.SAVED_SEARCH ||
    (alert.source == null && !!alert.savedSearchId)
  );
}

/**
 * `config.name` trimmed, or undefined when the tile has no usable one. Total
 * over `config?: unknown` for the same reason isUnexportableTile is — `tiles`
 * is a Mongoose `Mixed` array, so nothing guarantees a config, let alone a
 * name.
 *
 * Trimmed rather than raw so `"Errors"` and `"Errors "` count as the same key.
 * If the provider trims its `tile_ids` keys they collide, and treating them as
 * distinct would offer a reference that cannot resolve; if it does not trim,
 * the cost is withholding two alerts that would have worked. Wrong in the safe
 * direction.
 */
function tileName(tile: { config?: unknown } | undefined): string | undefined {
  const config = tile?.config;
  if (config == null || typeof config !== 'object') return undefined;
  const name = 'name' in config ? config.name : undefined;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * True when a tile alert's tile can be addressed in generated Terraform.
 *
 * Tile ids are server-assigned, so the provider exposes them as a computed
 * `tile_ids` map on `clickhouse_clickstack_dashboard`, keyed by tile name —
 * and a tile whose name is blank or shared with another tile is absent from
 * that map. An alert on one can only ever pin the literal id the server
 * happens to hold today, which the next dashboard apply is free to re-mint,
 * taking the alert with it. Not offered for import at all rather than offered
 * with a caveat: the failure lands at apply time, on the alert, long after the
 * export.
 */
export function isAddressableTile(
  tiles: readonly { id?: string; config?: unknown }[] | undefined,
  tileId: string | null | undefined,
): boolean {
  if (!tileId) return false;
  // Array.isArray for the same reason as dashboardHasUnexportableTiles: a
  // legacy Mixed row could hold something that is not an array.
  const list = Array.isArray(tiles) ? tiles : [];
  const name = tileName(list.find(t => t?.id === tileId));
  if (name == null) return false;
  return list.filter(t => tileName(t) === name).length === 1;
}

/**
 * The whole tile-alert rule, in one place: the alert's dashboard has to exist,
 * be one Terraform could own, and give the tile an addressable name.
 *
 * `provisioned` is here for the same reason isImportableDashboard rejects it —
 * ProvisionDashboardsTask rewrites a provisioned dashboard's tiles wholesale,
 * so the tile this alert is bound to can be replaced (and the server deletes a
 * tile alert whose tile goes away) with Terraform none the wiser.
 *
 * Both the IaC manifest and the alerts listing compute this server-side; the
 * client cannot, because neither response ships a dashboard's sibling tiles.
 */
export function isTileAlertUnaddressable(
  dashboard:
    | {
        provisioned?: boolean;
        tiles?: readonly { id?: string; config?: unknown }[];
      }
    | undefined,
  tileId: string | null | undefined,
): boolean {
  if (dashboard == null) return true;
  return !!dashboard.provisioned || !isAddressableTile(dashboard.tiles, tileId);
}

/**
 * The display types the external API v2 converter can represent for a raw-SQL
 * tile. Mirrors the `configType: 'sql'` switch in
 * packages/api/src/routers/external-api/v2/utils/dashboards.ts — every other
 * case there returns undefined. Kept as a set so the check below reads as the
 * allowlist it is.
 */
const RAW_SQL_EXPORTABLE_DISPLAY_TYPES: ReadonlySet<string> = new Set([
  DisplayType.Line,
  DisplayType.StackedBar,
  DisplayType.Table,
  DisplayType.Number,
  DisplayType.Pie,
  DisplayType.Bar,
]);

/**
 * True when a tile cannot survive the round trip the import flow puts it
 * through, so a dashboard containing one must not be offered for import.
 *
 * The documented flow is `terraform plan -generate-config-out` then `apply`.
 * The provider authenticates with a Personal API Access Key, so it reads
 * through the key-authenticated external API v2 — which is HyperDX's own
 * allowlist converter, not a path around it. Anything that converter cannot
 * represent comes back either dropped (PromQL, handled at the tile level) or
 * substituted with `defaultTileConfig`, an empty Line chart. The write path
 * then rebuilds `tiles` wholesale from the request body, so applying a config
 * generated from that read destroys the original tile either way.
 *
 * This mirrors the converter's rejection set rather than just its PromQL case,
 * using only `tile.config` — so the server manifest and the per-dashboard
 * popover, which cannot reach that converter, still decide identically. The one
 * case deliberately NOT flagged is a heatmap missing `select[0]`: the converter
 * emits a shape-preserving placeholder for it precisely so a re-apply fails the
 * input schema loudly instead of downgrading silently.
 *
 * Total over untrusted input on purpose, and typed `config?: unknown` to say
 * so: `Dashboard.tiles` is a Mongoose `Mixed` array, so the database enforces
 * nothing and a legacy row can carry a tile with no `config` at all. Claiming a
 * well-formed `SavedChartConfig` here would be a lie that pushed casts onto
 * every caller. Throwing would take down the manifest for the whole team over
 * one bad row.
 */
export function isUnexportableTile(tile: { config?: unknown }): boolean {
  const config = tile?.config;
  if (config == null || typeof config !== 'object') {
    // Unreadable rather than unexportable. Treated as exportable to match the
    // existing default for a source with no `kind`; the provider read is what
    // will reject it, loudly.
    return false;
  }

  // Narrowed with `in` rather than handed to isPromqlSavedChartConfig /
  // isRawSqlSavedChartConfig from ./guards: those take an already-typed
  // SavedChartConfig, and asserting one out of a Mongoose Mixed value is
  // exactly the unchecked cast this function exists to avoid. The discriminator
  // literals are duplicated from those guards on purpose.
  const configType = 'configType' in config ? config.configType : undefined;
  const displayType = 'displayType' in config ? config.displayType : undefined;

  if (configType === 'promql') return true;

  // The converter's `case undefined:` branch — no displayType to switch on.
  if (displayType == null) return true;

  return (
    configType === 'sql' &&
    typeof displayType === 'string' &&
    !RAW_SQL_EXPORTABLE_DISPLAY_TYPES.has(displayType)
  );
}

export function dashboardHasUnexportableTiles(
  tiles: readonly { config?: unknown }[] | undefined,
): boolean {
  // Array.isArray, not `?? []` — `tiles` is Mixed, so a legacy row could hold
  // a non-array and `.some` would throw.
  return (Array.isArray(tiles) ? tiles : []).some(isUnexportableTile);
}

/**
 * Two independent reasons a dashboard is not importable.
 *
 * `provisioned` — machine-managed by ProvisionDashboardsTask, whose name-keyed
 * upsert overwrites tiles, tags, and filters wholesale. Two managers for one
 * object is a fight nobody wins. The manifest also filters these out
 * server-side (`provisioned: { $ne: true }`); this keeps the per-dashboard
 * surface agreeing with it.
 *
 * `unexportableTiles` — content the import round trip would destroy, per
 * isUnexportableTile above. The server computes this, because the lean manifest
 * deliberately does not ship tile configs to the client.
 */
export function isImportableDashboard(dashboard: {
  provisioned?: boolean;
  unexportableTiles?: boolean;
}): boolean {
  return !dashboard.provisioned && !dashboard.unexportableTiles;
}

/**
 * A PromQL source has no `clickhouse_clickstack_source` representation — the
 * provider models the ClickHouse-backed kinds. Emitting one produces an import
 * block for a resource the provider cannot read, which fails the plan. Same
 * shape as the tile-alert rule: eligibility decided once, here.
 */
export function isImportableSource(source: { kind?: string }): boolean {
  return source.kind !== SourceKind.Promql;
}
