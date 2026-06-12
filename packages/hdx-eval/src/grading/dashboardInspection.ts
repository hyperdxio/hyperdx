/**
 * Post-run dashboard inspection for dashboard-build scenarios.
 *
 * Collects evidence about dashboards created during a run:
 *   1. Extracts dashboard IDs from save_dashboard tool call outputs
 *   2. Fetches full dashboard config (tile configs, containers)
 *   3. Queries each tile to get actual data results (sample rows)
 *   4. Counts 0-shot creates vs patch retries
 *   5. Cleans up (deletes) dashboards after inspection
 *
 * The collected evidence is fed to the LLM judge alongside the ground truth
 * so the judge can evaluate whether tiles are correctly configured and
 * return relevant data — not just "some data."
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
  /** The raw config object from the tile (select, groupBy, where, etc.) */
  config: Record<string, unknown>;
  /** Result of querying the tile post-run. */
  queryResult: {
    success: boolean;
    hasData: boolean;
    error?: string;
    /** Number of rows/data points returned. */
    rowCount?: number;
    /** Number of distinct groups (for grouped tiles). */
    groupCount?: number;
    /** First few rows of data for the judge to inspect. */
    sampleRows?: unknown[];
  };
};

/** Evidence about the dashboard's container/section structure. */
export type ContainerEvidence = {
  id: string;
  title: string;
  collapsed: boolean;
  tileCount: number;
};

export type DashboardInspectionResult = {
  /** Dashboard IDs extracted from save_dashboard tool calls. */
  dashboardIds: string[];
  /** Number of save_dashboard calls (0-shot creates). */
  createCalls: number;
  /** Number of save_dashboard calls that succeeded. */
  createSuccesses: number;
  /** Number of patch_dashboard calls (fix attempts). */
  patchCalls: number;
  /** Number of patch_dashboard calls that succeeded. */
  patchSuccesses: number;
  /** Number of query_tile calls the agent made during the run. */
  agentQueryTileCalls: number;
  /** Per-tile evidence for the LLM judge. */
  tileEvidence: TileEvidence[];
  /** Container/section evidence. */
  containerEvidence: ContainerEvidence[];
  /** Total tiles found on the dashboards. */
  totalTiles: number;
  /** Tiles that returned data when queried. */
  tilesWithData: number;
  /** Dashboards cleaned up (deleted) after inspection. */
  cleanedUp: string[];
  /** Errors during inspection or cleanup. */
  errors: string[];
};

// ─── Tool call analysis ──────────────────────────────────────────────────────

const SAVE_DASHBOARD_PATTERN =
  /clickstack_save_dashboard|hyperdx_save_dashboard/;
const PATCH_DASHBOARD_PATTERN =
  /clickstack_patch_dashboard|hyperdx_patch_dashboard/;
const QUERY_TILE_PATTERN = /clickstack_query_tile|hyperdx_query_tile/;

/**
 * Extract dashboard IDs from save_dashboard tool call outputs.
 */
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

  // ── Analyze tool calls ────────────────────────────────────────────
  const dashboardIds = extractDashboardIds(toolCalls);
  const creates = countToolCalls(toolCalls, SAVE_DASHBOARD_PATTERN);
  const patches = countToolCalls(toolCalls, PATCH_DASHBOARD_PATTERN);
  const agentQueries = countToolCalls(toolCalls, QUERY_TILE_PATTERN);

  // ── Inspect dashboards via API ────────────────────────────────────
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
      const dashboards = await client.listDashboards();
      const dashboard = dashboards.find(
        d => d._id === dashboardId || d.id === dashboardId,
      );
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
          });
        }
      }

      // ── Collect tile evidence ───────────────────────────────────
      for (const tile of dashboard.tiles) {
        totalTiles++;
        const tileId = tile.id ?? tile._id;
        if (!tileId) {
          tileEvidence.push({
            tileId: 'unknown',
            tileName: tile.name,
            displayType: String(tile.config?.displayType ?? 'unknown'),
            config: tile.config ?? {},
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

        // Skip markdown tiles
        if (tile.config?.displayType === 'markdown') {
          tileEvidence.push({
            tileId,
            tileName: tile.name,
            displayType: 'markdown',
            containerId,
            config: tile.config ?? {},
            queryResult: { success: true, hasData: true },
          });
          continue;
        }

        // Query the tile and collect evidence
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
            tileName: tile.name,
            displayType: String(tile.config?.displayType ?? 'unknown'),
            containerId,
            config: tile.config ?? {},
            queryResult,
          });
        } catch (err) {
          tileEvidence.push({
            tileId,
            tileName: tile.name,
            displayType: String(tile.config?.displayType ?? 'unknown'),
            containerId,
            config: tile.config ?? {},
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

/**
 * Format the dashboard inspection evidence into a human-readable string
 * that gets appended to the judge prompt.
 */
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
    `Creation stats: ${result.createCalls} save_dashboard calls (${result.createSuccesses} succeeded), ${result.patchCalls} patch_dashboard calls (${result.patchSuccesses} succeeded)`,
  );
  lines.push(
    `Agent ran ${result.agentQueryTileCalls} query_tile calls during the run.`,
  );
  lines.push('');

  // Containers
  if (result.containerEvidence.length > 0) {
    lines.push('Containers (sections):');
    for (const c of result.containerEvidence) {
      lines.push(
        `  - "${c.title}" (collapsed=${c.collapsed}, ${c.tileCount} tiles)`,
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

    // Show relevant config fields (not the full object)
    const config = tile.config;
    const configLines: string[] = [];
    if (config.select && Array.isArray(config.select)) {
      for (const s of config.select as Array<Record<string, unknown>>) {
        const parts = [`aggFn=${s.aggFn}`];
        if (s.valueExpression)
          parts.push(`valueExpression=${s.valueExpression}`);
        if (s.level != null) parts.push(`level=${s.level}`);
        if (s.where) parts.push(`where="${s.where}"`);
        if (s.alias) parts.push(`alias="${s.alias}"`);
        configLines.push(`    select: { ${parts.join(', ')} }`);
      }
    }
    if (config.groupBy) configLines.push(`    groupBy: ${config.groupBy}`);
    if (config.sqlTemplate) {
      const sql = String(config.sqlTemplate).replace(/\s+/g, ' ').trim();
      configLines.push(
        `    sqlTemplate: ${sql.length > 200 ? sql.slice(0, 200) + '...' : sql}`,
      );
    }
    if (config.configType)
      configLines.push(`    configType: ${config.configType}`);
    if (config.where) configLines.push(`    where: "${config.where}"`);
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
