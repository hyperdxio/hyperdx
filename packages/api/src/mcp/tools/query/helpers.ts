import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import ms from 'ms';

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

function formatQueryResult(result: unknown) {
  const trimmedResult = trimToolResponse(result);
  const isTrimmed =
    JSON.stringify(trimmedResult).length < JSON.stringify(result).length;
  const empty = isEmptyResult(result);
  return {
    content: [
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
    ],
  };
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

    return formatQueryResult(result);
  }

  // Raw SQL tile — look up connection by ID
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
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: undefined,
  });

  return formatQueryResult(result);
}
