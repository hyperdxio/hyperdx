/**
 * Post-run dashboard inspection for dashboard-build scenarios.
 *
 * Collects evidence about dashboards created during a run:
 *   1. Extracts dashboard IDs from save_dashboard tool call outputs
 *   2. Extracts tile configs from the agent's save_dashboard input (intent)
 *   3. Fetches the actual dashboard via the v2 API (ground truth)
 *   4. Queries each tile to get actual data results (sample rows)
 *   5. Counts 0-shot creates vs patch retries
 *   6. Cleans up (deletes) dashboards after inspection
 *
 * The collected evidence (both intended configs and actual query results) is
 * fed to the LLM judge so it can evaluate whether tiles are correctly
 * configured AND return relevant data.
 */
import type { ToolCallRecord } from '@/harness/types';
import type { ApiError } from '@/hyperdx/api';
import { HyperdxApiClient } from '@/hyperdx/api';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Full evidence collected for a single tile — fed to the LLM judge. */
export type TileEvidence = {
  tileId: string;
  tileName: string;
  displayType: string;
  containerId?: string;
  /** Tile layout dimensions. */
  w?: number;
  h?: number;
  /** The tile config as returned by the v2 API. */
  config: Record<string, unknown>;
  /** The tile config as sent by the agent in save_dashboard (intent). */
  intendedConfig?: Record<string, unknown>;
  /** Result of querying the tile post-run. */
  queryResult: {
    success: boolean;
    hasData: boolean;
    error?: string;
    rowCount?: number;
    groupCount?: number;
    sampleRows?: unknown[];
  };
};

/** Evidence about the dashboard's container/section structure. */
export type ContainerEvidence = {
  id: string;
  title: string;
  collapsed: boolean;
  tileCount: number;
  tabs?: Array<{ id: string; title: string }>;
};

export type DashboardInspectionResult = {
  dashboardIds: string[];
  createCalls: number;
  createSuccesses: number;
  patchCalls: number;
  patchSuccesses: number;
  agentQueryTileCalls: number;
  tileEvidence: TileEvidence[];
  containerEvidence: ContainerEvidence[];
  totalTiles: number;
  tilesWithData: number;
  cleanedUp: string[];
  errors: string[];
};

// ─── Tool call analysis ──────────────────────────────────────────────────────

/** Matches ObjectIds (24 hex), UUIDs, and other alphanumeric IDs. */
const ID_REGEX = /"id"\s*:\s*"([a-f0-9-]{24,36})"/;

const SAVE_DASHBOARD_PATTERN =
  /clickstack_save_dashboard|hyperdx_save_dashboard/;
const PATCH_DASHBOARD_PATTERN =
  /clickstack_patch_dashboard|hyperdx_patch_dashboard/;
const QUERY_TILE_PATTERN = /clickstack_query_tile|hyperdx_query_tile/;

function extractDashboardIds(toolCalls: ToolCallRecord[]): string[] {
  const ids = new Set<string>();
  for (const call of toolCalls) {
    if (!SAVE_DASHBOARD_PATTERN.test(call.name)) continue;
    if (call.isError || !call.output) continue;
    try {
      const parsed = JSON.parse(call.output);
      const id = parsed?.id ?? parsed?.data?.id ?? parsed?.dashboardId;
      if (typeof id === 'string' && id.length > 0) {
        ids.add(id);
      }
      if (Array.isArray(parsed?.content)) {
        for (const block of parsed.content) {
          if (typeof block?.text === 'string') {
            try {
              const inner = JSON.parse(block.text);
              if (inner?.id) ids.add(inner.id);
            } catch {
              const match = block.text.match(ID_REGEX);
              if (match) ids.add(match[1]);
            }
          }
        }
      }
    } catch {
      const match = call.output.match(ID_REGEX);
      if (match) ids.add(match[1]);
    }
  }
  return [...ids];
}

/**
 * Extract the tile configs the agent intended to create from its
 * save_dashboard tool call input. Returns a map of tile name → config.
 * Keys are prefixed with a per-call index to avoid collisions when
 * multiple dashboards share tile names (e.g., "Error Rate" in both
 * Dashboard 1 and Dashboard 2).
 */
function extractIntendedTileConfigs(
  toolCalls: ToolCallRecord[],
): Map<string, Record<string, unknown>> {
  const configs = new Map<string, Record<string, unknown>>();
  let callIdx = 0;
  for (const call of toolCalls) {
    if (!SAVE_DASHBOARD_PATTERN.test(call.name)) continue;
    callIdx++;
    const input = call.input as Record<string, unknown> | null;
    if (!input) continue;
    const tiles = input.tiles as
      | Array<{ name?: string; config?: Record<string, unknown> }>
      | undefined;
    if (!Array.isArray(tiles)) continue;
    for (const tile of tiles) {
      const name = tile.name ?? (tile.config as Record<string, unknown>)?.name;
      if (typeof name === 'string' && tile.config) {
        // Store with plain name (for lookup by tile name from the API response)
        // and with indexed prefix (for disambiguation across dashboards).
        // The plain-name entry gets overwritten if two dashboards share a name,
        // but the indexed entry is always unique.
        configs.set(name, tile.config);
        configs.set(`${callIdx}:${name}`, tile.config);
      }
    }
  }
  return configs;
}

function countToolCalls(
  toolCalls: ToolCallRecord[],
  pattern: RegExp,
): { total: number; successes: number } {
  let total = 0;
  let successes = 0;
  for (const call of toolCalls) {
    if (!pattern.test(call.name)) continue;
    total++;
    if (!call.isError) successes++;
  }
  return { total, successes };
}

// ─── Dashboard inspection ────────────────────────────────────────────────────

export async function inspectDashboards(args: {
  toolCalls: ToolCallRecord[];
  apiUrl: string;
  accessKey: string;
  email: string;
  password: string;
  anchorTimeIso?: string;
  cleanup?: boolean;
}): Promise<DashboardInspectionResult> {
  const {
    toolCalls,
    apiUrl,
    accessKey,
    email,
    password,
    anchorTimeIso,
    cleanup = true,
  } = args;

  const errors: string[] = [];

  const dashboardIds = extractDashboardIds(toolCalls);
  const creates = countToolCalls(toolCalls, SAVE_DASHBOARD_PATTERN);
  const patches = countToolCalls(toolCalls, PATCH_DASHBOARD_PATTERN);
  const agentQueries = countToolCalls(toolCalls, QUERY_TILE_PATTERN);
  const intendedConfigs = extractIntendedTileConfigs(toolCalls);

  const client = new HyperdxApiClient(apiUrl);
  await client.login(email, password);

  const tileEvidence: TileEvidence[] = [];
  const containerEvidence: ContainerEvidence[] = [];
  let totalTiles = 0;

  const endTime = anchorTimeIso ?? new Date().toISOString();
  const endMs = Date.parse(endTime);
  const startTime = new Date(endMs - 60 * 60 * 1000).toISOString();

  for (const dashboardId of dashboardIds) {
    try {
      // Use v2 API for clean tile names + configs
      const dashboard = await client.getDashboardV2(dashboardId, accessKey);
      if (!dashboard || !dashboard.tiles) {
        errors.push(`Dashboard ${dashboardId} not found or has no tiles`);
        continue;
      }

      // ── Collect container evidence ──────────────────────────────
      const rawDashboard = dashboard as Record<string, unknown>;
      const containers = rawDashboard.containers as
        | Array<{
            id: string;
            title: string;
            collapsed: boolean;
            tabs?: Array<{ id: string; title: string }>;
          }>
        | undefined;
      if (containers && Array.isArray(containers)) {
        for (const c of containers) {
          const tilesInContainer = dashboard.tiles.filter(
            (t: Record<string, unknown>) => t.containerId === c.id,
          ).length;
          containerEvidence.push({
            id: c.id,
            title: c.title,
            collapsed: c.collapsed,
            tileCount: tilesInContainer,
            tabs: c.tabs,
          });
        }
      }

      // ── Collect tile evidence ───────────────────────────────────
      for (const tile of dashboard.tiles) {
        totalTiles++;
        const tileId = tile.id ?? tile._id;
        const tileName = tile.name ?? 'unknown';

        const containerId = tile.containerId;
        const tileW = tile.w;
        const tileH = tile.h;

        if (tile.config?.displayType === 'markdown') {
          tileEvidence.push({
            tileId,
            tileName: String(tileName),
            displayType: 'markdown',
            containerId,
            w: tileW,
            h: tileH,
            config: tile.config ?? {},
            queryResult: { success: true, hasData: true },
          });
          continue;
        }

        try {
          const queryResult = await client.queryTileWithEvidence({
            accessKey,
            dashboardId,
            tileId,
            startTime,
            endTime,
          });
          tileEvidence.push({
            tileId,
            tileName: String(tileName),
            displayType: String(tile.config?.displayType ?? 'unknown'),
            containerId,
            w: tileW,
            h: tileH,
            config: tile.config ?? {},
            intendedConfig: intendedConfigs.get(String(tileName)),
            queryResult,
          });
        } catch (err) {
          tileEvidence.push({
            tileId,
            tileName: String(tileName),
            displayType: String(tile.config?.displayType ?? 'unknown'),
            containerId,
            w: tileW,
            h: tileH,
            config: tile.config ?? {},
            intendedConfig: intendedConfigs.get(String(tileName)),
            queryResult: {
              success: false,
              hasData: false,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    } catch (err) {
      const status = (err as ApiError).status;
      const prefix =
        status === 404
          ? `Dashboard ${dashboardId} not found (404)`
          : `Failed to inspect dashboard ${dashboardId}`;
      errors.push(`${prefix}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const tilesWithData = tileEvidence.filter(t => t.queryResult.hasData).length;

  // ── Cleanup ───────────────────────────────────────────────────────
  const cleanedUp: string[] = [];
  if (cleanup) {
    for (const id of dashboardIds) {
      try {
        await client.deleteDashboard(id);
        cleanedUp.push(id);
      } catch (err) {
        errors.push(
          `Failed to delete dashboard ${id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return {
    dashboardIds,
    createCalls: creates.total,
    createSuccesses: creates.successes,
    patchCalls: patches.total,
    patchSuccesses: patches.successes,
    agentQueryTileCalls: agentQueries.total,
    tileEvidence,
    containerEvidence,
    totalTiles,
    tilesWithData,
    cleanedUp,
    errors,
  };
}

// ─── Evidence formatting for the LLM judge ──────────────────────────────────

// ─── Distractor / misleading-data awareness analysis ──────────────────────────
//
// The dashboard-build scenario plants several "real world is messy" traps:
//   - 4 internal/distractor services (health-checker, cron-scheduler,
//     internal-metrics, debug-proxy) mixed in with 3 user-facing ones
//   - debug-proxy's 15% error rate is debug traffic, not a real incident
//   - inventory-service's high P99 is one slow admin endpoint
//     (`/inventory/levels`), not the user paths
//   - log SeverityText is stored verbatim with mixed case + aliases
//     (`error`/`ERROR`/`fatal`), so naive exact-match ERROR filters under-count
//   - `staging` traffic is blended into `production`
//
// These signals are heuristic (text scan of every tile config) and are surfaced
// to the LLM judge as explicit hints — turning a fuzzy "did the agent notice?"
// judgment into concrete evidence the judge can cite.

const DISTRACTOR_SERVICES = [
  'health-checker',
  'cron-scheduler',
  'internal-metrics',
  'debug-proxy',
] as const;

const USER_FACING_SERVICES = [
  'web-gateway',
  'order-service',
  'inventory-service',
] as const;

export type DistractorAwarenessSignals = {
  /** Any tile config text references a distractor service by name. */
  mentionsDistractorServices: boolean;
  /** Any tile filters/excludes distractor services (NOT IN / != / excludes). */
  filtersOutDistractors: boolean;
  /** Any tile scopes explicitly to the user-facing services (IN allow-list). */
  scopesToUserFacing: boolean;
  /** Any tile addresses the messy severity (lower(SeverityText), IN-list, etc.) */
  handlesMessySeverity: boolean;
  /** Any latency tile breaks down by endpoint/SpanName (sees the red herring). */
  latencyBrokenDownByEndpoint: boolean;
  /** Any tile filters by deployment environment (production vs staging). */
  filtersByEnvironment: boolean;
};

/** Concatenate every tile's intended + actual config into one searchable blob. */
function tileConfigText(result: DashboardInspectionResult): string {
  const blobs: string[] = [];
  for (const tile of result.tileEvidence) {
    if (tile.intendedConfig) blobs.push(JSON.stringify(tile.intendedConfig));
    if (tile.config) blobs.push(JSON.stringify(tile.config));
  }
  return blobs.join('\n');
}

export function analyzeDistractorAwareness(
  result: DashboardInspectionResult,
): DistractorAwarenessSignals {
  const text = tileConfigText(result);
  const lower = text.toLowerCase();

  const mentionsDistractorServices = DISTRACTOR_SERVICES.some(s =>
    lower.includes(s),
  );

  // Heuristic: a distractor name appears near an exclusion/allow-list operator.
  const exclusionNearDistractor = DISTRACTOR_SERVICES.some(svc => {
    const idx = lower.indexOf(svc);
    if (idx === -1) return false;
    // Look at a window around the mention for exclusion / IN-list operators.
    const window = lower.slice(Math.max(0, idx - 60), idx + svc.length + 10);
    return (
      window.includes('not in') ||
      window.includes('!=') ||
      window.includes('not like') ||
      window.includes('notlike') ||
      window.includes('exclud')
    );
  });
  const filtersOutDistractors = exclusionNearDistractor;

  // Allow-list: an `IN (...)` (or multiple equality ORs) referencing the
  // user-facing services without the distractors.
  const userFacingInList =
    /\bin\s*\(\s*'?(web-gateway|order-service|inventory-service)/.test(lower) &&
    USER_FACING_SERVICES.every(s => lower.includes(s)) &&
    !DISTRACTOR_SERVICES.some(s => lower.includes(s));
  const scopesToUserFacing = userFacingInList;

  const handlesMessySeverity =
    lower.includes('lower(severitytext') ||
    lower.includes('upper(severitytext') ||
    /severitytext\s+in\s*\(/.test(lower) ||
    lower.includes("'fatal'") ||
    /severitytext.{0,20}(ilike|like)/.test(lower);

  const latencyBrokenDownByEndpoint =
    lower.includes('spanname') &&
    (lower.includes('quantile') || lower.includes('duration'));

  const filtersByEnvironment =
    lower.includes('deployment.environment') ||
    lower.includes("'staging'") ||
    lower.includes("'production'");

  return {
    mentionsDistractorServices,
    filtersOutDistractors,
    scopesToUserFacing,
    handlesMessySeverity,
    latencyBrokenDownByEndpoint,
    filtersByEnvironment,
  };
}

export function formatDashboardEvidence(
  result: DashboardInspectionResult,
): string {
  const lines: string[] = [];

  lines.push('DASHBOARD ARTIFACT (inspected post-run by the eval harness):');
  lines.push('');

  if (result.dashboardIds.length === 0) {
    lines.push(
      'NO DASHBOARDS WERE CREATED. The agent did not successfully call save_dashboard.',
    );
    lines.push(
      `Tool call counts: save_dashboard=${result.createCalls} (${result.createSuccesses} succeeded), patch_dashboard=${result.patchCalls}`,
    );
    return lines.join('\n');
  }

  lines.push(`Dashboard IDs: ${result.dashboardIds.join(', ')}`);
  lines.push(
    `Creation stats: ${result.createCalls} save_dashboard (${result.createSuccesses} ok), ${result.patchCalls} patch_dashboard (${result.patchSuccesses} ok), ${result.agentQueryTileCalls} query_tile calls`,
  );
  lines.push('');

  // Containers
  if (result.containerEvidence.length > 0) {
    lines.push('Containers (sections):');
    for (const c of result.containerEvidence) {
      const tabInfo =
        c.tabs && c.tabs.length > 0
          ? ` tabs: [${c.tabs.map(t => `"${t.title}"`).join(', ')}]`
          : '';
      lines.push(
        `  - "${c.title}" (collapsed=${c.collapsed}, ${c.tileCount} tiles${tabInfo})`,
      );
    }
    lines.push('');
  } else {
    lines.push(
      'NO CONTAINERS — all tiles are flat (not organized into sections).',
    );
    lines.push('');
  }

  // Tiles
  lines.push(
    `Tiles (${result.totalTiles} total, ${result.tilesWithData} returned data):`,
  );
  lines.push('');

  for (let i = 0; i < result.tileEvidence.length; i++) {
    const tile = result.tileEvidence[i];
    lines.push(`Tile ${i + 1}: "${tile.tileName}"`);
    lines.push(
      `  displayType: ${tile.displayType}  layout: ${tile.w ?? '?'}w x ${tile.h ?? '?'}h`,
    );
    if (tile.containerId) {
      const container = result.containerEvidence.find(
        c => c.id === tile.containerId,
      );
      lines.push(`  container: "${container?.title ?? tile.containerId}"`);
    }

    // Show the intended config from the agent's tool call (most accurate)
    const configToShow = tile.intendedConfig ?? tile.config;
    const configLines: string[] = [];
    if (configToShow.select && Array.isArray(configToShow.select)) {
      for (const s of configToShow.select as Array<Record<string, unknown>>) {
        const parts = [`aggFn=${s.aggFn}`];
        if (s.valueExpression)
          parts.push(`valueExpression=${s.valueExpression}`);
        if (s.level != null) parts.push(`level=${s.level}`);
        if (s.where) parts.push(`where="${s.where}"`);
        if (s.alias) parts.push(`alias="${s.alias}"`);
        if (s.numberFormat)
          parts.push(`numberFormat=${JSON.stringify(s.numberFormat)}`);
        configLines.push(`    select: { ${parts.join(', ')} }`);
      }
    }
    if (configToShow.groupBy)
      configLines.push(`    groupBy: ${configToShow.groupBy}`);
    if (configToShow.asRatio) configLines.push(`    asRatio: true`);
    if (configToShow.numberFormat)
      configLines.push(
        `    numberFormat: ${JSON.stringify(configToShow.numberFormat)}`,
      );
    if (configToShow.sqlTemplate) {
      const sql = String(configToShow.sqlTemplate).replace(/\s+/g, ' ').trim();
      configLines.push(
        `    sqlTemplate: ${sql.length > 200 ? sql.slice(0, 200) + '...' : sql}`,
      );
    }
    if (configToShow.configType)
      configLines.push(`    configType: ${configToShow.configType}`);
    if (configToShow.where)
      configLines.push(`    where: "${configToShow.where}"`);
    if (configToShow.onClick) {
      configLines.push(
        `    onClick: ${JSON.stringify(configToShow.onClick).slice(0, 300)}`,
      );
    }
    if (configToShow.sourceId)
      configLines.push(`    sourceId: ${configToShow.sourceId}`);
    if (configLines.length > 0) {
      lines.push('  config:');
      lines.push(...configLines);
    }

    // Query result
    const qr = tile.queryResult;
    if (!qr.success) {
      lines.push(`  query: FAILED — ${qr.error ?? 'unknown error'}`);
    } else if (!qr.hasData) {
      lines.push('  query: succeeded but returned NO DATA');
    } else {
      const parts = ['returned data'];
      if (qr.rowCount != null) parts.push(`${qr.rowCount} rows`);
      if (qr.groupCount != null) parts.push(`${qr.groupCount} groups`);
      lines.push(`  query: ${parts.join(', ')}`);
      if (qr.sampleRows && qr.sampleRows.length > 0) {
        lines.push(
          `  sample: ${JSON.stringify(qr.sampleRows.slice(0, 3)).slice(0, 500)}`,
        );
      }
    }
    lines.push('');
  }

  // ── Misleading-data / distractor-awareness signals ──────────────────
  const signals = analyzeDistractorAwareness(result);
  lines.push('MISLEADING-DATA AWARENESS (heuristic scan of tile configs):');
  lines.push(
    `  - distractor services referenced in any tile: ${signals.mentionsDistractorServices}`,
  );
  lines.push(
    `  - any tile filters OUT distractor services (NOT IN / != / exclude): ${signals.filtersOutDistractors}`,
  );
  lines.push(
    `  - any tile scopes to the 3 user-facing services (allow-list): ${signals.scopesToUserFacing}`,
  );
  lines.push(
    `  - latency broken down by endpoint/SpanName (sees the inventory red herring): ${signals.latencyBrokenDownByEndpoint}`,
  );
  lines.push(
    `  - handles messy SeverityText casing/aliases (lower()/IN-list/fatal): ${signals.handlesMessySeverity}`,
  );
  lines.push(
    `  - filters by deployment environment (production vs staging): ${signals.filtersByEnvironment}`,
  );
  lines.push(
    '  NOTE for judge: if distractor services are referenced but NOT filtered out, ' +
      'and no tile scopes to user-facing services, the dashboard blends internal ' +
      'infrastructure traffic with real user traffic — this is the primary ' +
      'data_awareness failure mode. A naive service-level latency tile that is ' +
      'NOT broken down by endpoint presents inventory-service as unhealthy when ' +
      "it is one slow admin export. A SeverityText='ERROR' exact-match filter " +
      'under-counts errors because the data stores mixed-case + `fatal` variants.',
  );
  lines.push('');

  return lines.join('\n');
}
