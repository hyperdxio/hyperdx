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
import type { ToolCallRecord } from '../harness/types';
import { HyperdxApiClient } from '../hyperdx/api';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Full evidence collected for a single tile — fed to the LLM judge. */
export type TileEvidence = {
  tileId: string;
  tileName: string;
  displayType: string;
  containerId?: string;
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
              const match = block.text.match(/"id"\s*:\s*"([a-f0-9]{24})"/);
              if (match) ids.add(match[1]);
            }
          }
        }
      }
    } catch {
      const match = call.output.match(/"id"\s*:\s*"([a-f0-9]{24})"/);
      if (match) ids.add(match[1]);
    }
  }
  return [...ids];
}

/**
 * Extract the tile configs the agent intended to create from its
 * save_dashboard tool call input. Returns a map of tile name → config.
 */
function extractIntendedTileConfigs(
  toolCalls: ToolCallRecord[],
): Map<string, Record<string, unknown>> {
  const configs = new Map<string, Record<string, unknown>>();
  for (const call of toolCalls) {
    if (!SAVE_DASHBOARD_PATTERN.test(call.name)) continue;
    const input = call.input as Record<string, unknown> | null;
    if (!input) continue;
    const tiles = input.tiles as
      | Array<{ name?: string; config?: Record<string, unknown> }>
      | undefined;
    if (!Array.isArray(tiles)) continue;
    for (const tile of tiles) {
      const name = tile.name ?? (tile.config as Record<string, unknown>)?.name;
      if (typeof name === 'string' && tile.config) {
        configs.set(name, tile.config);
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
        const tileName =
          tile.name ??
          (tile.config as Record<string, unknown>)?.name ??
          'unknown';

        if (!tileId) {
          tileEvidence.push({
            tileId: 'unknown',
            tileName: String(tileName),
            displayType: String(tile.config?.displayType ?? 'unknown'),
            config: tile.config ?? {},
            intendedConfig: intendedConfigs.get(String(tileName)),
            queryResult: {
              success: false,
              hasData: false,
              error: 'No tile ID',
            },
          });
          continue;
        }

        const containerId = (tile as Record<string, unknown>).containerId as
          | string
          | undefined;

        if (tile.config?.displayType === 'markdown') {
          tileEvidence.push({
            tileId,
            tileName: String(tileName),
            displayType: 'markdown',
            containerId,
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
      errors.push(
        `Failed to inspect dashboard ${dashboardId}: ${err instanceof Error ? err.message : err}`,
      );
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
    lines.push(`  displayType: ${tile.displayType}`);
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

  return lines.join('\n');
}
