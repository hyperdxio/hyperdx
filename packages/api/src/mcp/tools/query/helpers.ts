import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type {
  ChartConfigWithDateRange,
  MetricTable,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';
import ms from 'ms';

import { FRONTEND_URL } from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  convertToInternalTileConfig,
  isConfigTile,
} from '@/routers/external-api/v2/utils/dashboards';
import { trimToolResponse } from '@/utils/trimToolResponse';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

// ─── Time range ──────────────────────────────────────────────────────────────

export function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - ms('15m'));
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  return { startDate, endDate };
}

// ─── Result helpers ──────────────────────────────────────────────────────────

function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.data) && obj.data.length === 0) return true;
    if (obj.rows != null && Number(obj.rows) === 0) return true;
  }
  return false;
}

function formatQueryResult(
  result: unknown,
  ui?: {
    displayType: string;
    config: SavedChartConfig;
    dateRange: [Date, Date];
  },
) {
  const trimmedResult = trimToolResponse(result);
  const isTrimmed =
    JSON.stringify(trimmedResult).length < JSON.stringify(result).length;
  const empty = isEmptyResult(result);

  const content = [
    {
      type: 'text' as const,
      text: JSON.stringify(
        {
          result: trimmedResult,
          ...(isTrimmed
            ? {
                note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
              }
            : {}),
          ...(empty
            ? {
                hint: 'No data found in the queried time range. Try setting startTime to a wider window (e.g. 24 hours ago) or check that filters match existing data.',
              }
            : {}),
        },
        null,
        2,
      ),
    },
  ];

  // structuredContent powers the MCP Apps widget (`ui://hyperdx/widget`).
  // Hosts that don't support MCP Apps will simply ignore this field.
  // We send the *non-trimmed* result here so the chart has the full series.
  if (ui) {
    return {
      content,
      structuredContent: buildStructuredContent(result, ui),
    };
  }

  return { content };
}

// ─── MCP Apps structuredContent ──────────────────────────────────────────────

/**
 * Build the payload consumed by the `ui://hyperdx/widget` iframe.
 *
 * Shape contract (kept stable; widget HTML reads these exact field names):
 *   {
 *     displayType: 'line' | 'stacked_bar' | 'table' | 'number' | ...,
 *     config:      <SavedChartConfig>,         // for context, axis labels, name
 *     data:        <ResponseJSON>,             // ClickHouse JSON: { meta, data, rows }
 *     links: {
 *       openInHyperdxUrl: string,              // /chart?config=<json>&from=&to=
 *     },
 *   }
 */
function buildStructuredContent(
  result: unknown,
  ui: {
    displayType: string;
    config: SavedChartConfig;
    dateRange: [Date, Date];
  },
) {
  return {
    displayType: ui.displayType,
    config: ui.config,
    data: result,
    links: {
      openInHyperdxUrl: buildOpenInHyperdxUrl(ui.config, ui.dateRange),
    },
  };
}

/**
 * Build a `/chart?config=…&from=…&to=…` URL that opens the same chart in the
 * HyperDX console. The /chart page already accepts a JSON-encoded
 * SavedChartConfig in its `config` query parameter (see DBChartPage.tsx).
 */
export function buildOpenInHyperdxUrl(
  config: SavedChartConfig,
  dateRange: [Date, Date],
): string | undefined {
  if (!FRONTEND_URL) return undefined;
  const params = new URLSearchParams();
  params.set('config', JSON.stringify(config));
  params.set('from', String(dateRange[0].getTime()));
  params.set('to', String(dateRange[1].getTime()));
  return `${FRONTEND_URL}/chart?${params.toString()}`;
}

// ─── Tile execution ──────────────────────────────────────────────────────────

export async function runConfigTile(
  teamId: string,
  tile: ExternalDashboardTileWithId,
  startDate: Date,
  endDate: Date,
  options?: { maxResults?: number },
) {
  if (!isConfigTile(tile)) {
    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: 'Invalid tile: config field missing' },
      ],
    };
  }

  const internalTile = convertToInternalTileConfig(tile);
  const savedConfig = internalTile.config;

  if (!isRawSqlSavedChartConfig(savedConfig)) {
    const builderConfig = savedConfig;

    if (
      !builderConfig.source ||
      builderConfig.displayType === DisplayType.Markdown
    ) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Markdown tile: no query to execute.',
          },
        ],
      };
    }

    const source = await getSource(teamId, builderConfig.source);
    if (!source) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Source not found: ${builderConfig.source}`,
          },
        ],
      };
    }

    const connection = await getConnectionById(
      teamId,
      source.connection.toString(),
      true,
    );
    if (!connection) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Connection not found for source: ${builderConfig.source}`,
          },
        ],
      };
    }

    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    const isSearch = builderConfig.displayType === DisplayType.Search;
    const defaultTableSelect =
      'defaultTableSelectExpression' in source
        ? source.defaultTableSelectExpression
        : undefined;
    const implicitColumn =
      'implicitColumnExpression' in source
        ? source.implicitColumnExpression
        : undefined;
    const searchOverrides = isSearch
      ? {
          select: builderConfig.select || defaultTableSelect || '*',
          groupBy: undefined,
          granularity: undefined,
          orderBy: [
            {
              ordering: 'DESC' as const,
              valueExpression: getFirstTimestampValueExpression(
                source.timestampValueExpression,
              ),
            },
          ],
          limit: { limit: options?.maxResults ?? 50, offset: 0 },
        }
      : {};

    const chartConfig = {
      ...builderConfig,
      ...searchOverrides,
      from: {
        databaseName: source.from.databaseName,
        tableName: source.from.tableName,
      },
      connection: source.connection.toString(),
      timestampValueExpression: source.timestampValueExpression,
      implicitColumnExpression: implicitColumn,
      dateRange: [startDate, endDate] as [Date, Date],
    } satisfies ChartConfigWithDateRange;

    const metadata = getMetadata(clickhouseClient);
    const result = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
      querySettings: source.querySettings,
    });

    return formatQueryResult(result, {
      displayType: String(builderConfig.displayType ?? 'table'),
      // savedConfig is the internal SavedChartConfig (no dateRange field).
      // The /chart page reconstructs dateRange from from/to URL params.
      config: savedConfig,
      dateRange: [startDate, endDate],
    });
  }

  // Raw SQL tile: hydrate source fields for macro support ($__sourceTable, $__filters)
  let sourceFields: {
    from?: { databaseName: string; tableName: string };
    implicitColumnExpression?: string;
    metricTables?: MetricTable;
  } = {};
  if (savedConfig.source) {
    const source = await getSource(teamId, savedConfig.source);
    if (source) {
      sourceFields = {
        from: source.from,
        implicitColumnExpression:
          'implicitColumnExpression' in source
            ? source.implicitColumnExpression
            : undefined,
        metricTables:
          source.kind === SourceKind.Metric ? source.metricTables : undefined,
      };
    }
  }

  const connection = await getConnectionById(
    teamId,
    savedConfig.connection,
    true,
  );
  if (!connection) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `Connection not found: ${savedConfig.connection}`,
        },
      ],
    };
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const chartConfig = {
    ...savedConfig,
    ...sourceFields,
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: undefined,
  });

  return formatQueryResult(result, {
    displayType: String(savedConfig.displayType ?? 'table'),
    config: savedConfig,
    dateRange: [startDate, endDate],
  });
}
