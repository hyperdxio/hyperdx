import { createAnthropic } from '@ai-sdk/anthropic';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  getMetadata,
  TableMetadata,
} from '@hyperdx/common-utils/dist/metadata';
import {
  AggregateFunctionSchema,
  ChartConfigWithDateRange,
  DisplayType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { generateObject } from 'ai';
import * as chrono from 'chrono-node';
import express from 'express';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

function normalizeParsedDate(parsed?: chrono.ParsedComponents): Date | null {
  if (!parsed) {
    return null;
  }

  if (parsed.isCertain('year')) {
    return parsed.date();
  }

  const now = new Date();
  if (
    !(
      parsed.isCertain('hour') ||
      parsed.isCertain('minute') ||
      parsed.isCertain('second') ||
      parsed.isCertain('millisecond')
    )
  ) {
    // If all of the time components have been inferred, set the time components of now
    // to match the parsed time components. This ensures that the comparison later on uses
    // the same point in time when only worrying about dates.
    now.setHours(parsed.get('hour') || 0);
    now.setMinutes(parsed.get('minute') || 0);
    now.setSeconds(parsed.get('second') || 0);
    now.setMilliseconds(parsed.get('millisecond') || 0);
  }

  const parsedDate = parsed.date();
  if (parsedDate > now) {
    parsedDate.setFullYear(parsedDate.getFullYear() - 1);
  }
  return parsedDate;
}

export function parseTimeRangeInput(
  str: string,
  isUTC: boolean = false,
): [Date | null, Date | null] {
  const parsedTimeResults = chrono.parse(str, isUTC ? { timezone: 0 } : {});
  if (parsedTimeResults.length === 0) {
    return [null, null];
  }

  const parsedTimeResult =
    parsedTimeResults.length === 1
      ? parsedTimeResults[0]
      : parsedTimeResults[1];
  const start = normalizeParsedDate(parsedTimeResult.start);
  const end = normalizeParsedDate(parsedTimeResult.end) || new Date();
  if (end && start && end < start) {
    // For date range strings that omit years, the chrono parser will infer the year
    // using the current year. This can cause the start date to be in the future, and
    // returned as the end date instead of the start date. After normalizing the dates,
    // we then need to swap the order to maintain a range from older to newer.
    return [end, start];
  } else {
    return [start, end];
  }
}

export const LIVE_TAIL_TIME_QUERY = 'Live Tail';

export const RELATIVE_TIME_OPTIONS: ([string, string] | 'divider')[] = [
  // ['Last 15 seconds', '15s'],
  // ['Last 30 seconds', '30s'],
  // 'divider',
  ['Last 1 minute', '1m'],
  ['Last 5 minutes', '5m'],
  ['Last 15 minutes', '15m'],
  ['Last 30 minutes', '30m'],
  ['Last 45 minutes', '45m'],
  'divider',
  ['Last 1 hour', '1h'],
  ['Last 3 hours', '3h'],
  ['Last 6 hours', '6h'],
  ['Last 12 hours', '12h'],
  'divider',
  ['Last 1 days', '1d'],
  ['Last 2 days', '2d'],
  ['Last 7 days', '7d'],
  ['Last 14 days', '14d'],
  ['Last 30 days', '30d'],
];

export const DURATION_OPTIONS = [
  '30s',
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '3h',
  '6h',
  '12h',
];

export const DURATIONS: Record<string, any> = {
  '30s': { seconds: 30 },
  '1m': { minutes: 1 },
  '5m': { minutes: 5 },
  '15m': { minutes: 15 },
  '30m': { minutes: 30 },
  '1h': { hours: 1 },
  '3h': { hours: 3 },
  '6h': { hours: 6 },
  '12h': { hours: 12 },
};

export const dateParser = (input?: string) => {
  if (!input) {
    return null;
  }
  const parsed = chrono.casual.parse(input)[0];
  return normalizeParsedDate(parsed?.start);
};

// TODO: Dedup from DBSearchPageFilters
function isFieldPrimary(tableMetadata: TableMetadata | undefined, key: string) {
  return tableMetadata?.primary_key?.includes(key);
}

// TODO: Dedup w/ app/src/utils.ts
// Date formatting
export const mergePath = (path: string[], jsonColumns: string[] = []) => {
  const [key, ...rest] = path;
  if (rest.length === 0) {
    return key;
  }
  return jsonColumns.includes(key)
    ? `${key}.${rest
        .map(v =>
          v
            .split('.')
            .map(v => (v.startsWith('`') && v.endsWith('`') ? v : `\`${v}\``))
            .join('.'),
        )
        .join('.')}`
    : `${key}['${rest.join("']['")}']`;
};

router.post(
  '/assistant',
  validateRequest({
    body: z.object({
      text: z.string().min(1).max(10000),
      sourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      if (!config.ANTHROPIC_API_KEY) {
        logger.error('No ANTHROPIC_API_KEY defined');
        return res.status(500).json({});
      }

      const { teamId } = getNonNullUserWithTeam(req);

      const { text, sourceId } = req.body;

      const source = await getSource(teamId.toString(), sourceId);

      if (source == null) {
        logger.error({ message: 'invalid source id', sourceId, teamId });
        return res.status(400).json({
          error: 'Invalid source',
        });
      }

      const connectionId = source.connection.toString();

      const connection = await getConnectionById(
        teamId.toString(),
        connectionId,
      );

      if (connection == null) {
        logger.error({
          message: 'invalid connection id',
          connectionId,
          teamId,
        });
        return res.status(400).json({
          error: 'Invalid connection',
        });
      }

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });
      const metadata = getMetadata(clickhouseClient);

      const databaseName = source.from.databaseName;
      const tableName = source.from.tableName;

      const tableMetadata = await metadata.getTableMetadata({
        databaseName,
        tableName,
        connectionId,
      });

      const allFields = await metadata.getAllFields({
        databaseName,
        tableName,
        connectionId,
      });

      // TODO: Dedup with DBSearchPageFilters.tsx logic
      allFields.sort((a, b) => {
        // Prioritize primary keys
        // TODO: Support JSON
        const aPath = mergePath(a.path, []);
        const bPath = mergePath(b.path, []);
        if (isFieldPrimary(tableMetadata, aPath)) {
          return -1; // TODO: Check sort order
        } else if (isFieldPrimary(tableMetadata, bPath)) {
          return 1;
        }

        //First show low cardinality fields
        const isLowCardinality = (type: string) =>
          type.includes('LowCardinality');
        return isLowCardinality(a.type) && !isLowCardinality(b.type) ? -1 : 1;
      });

      const allFieldsWithKeys = allFields.map(f => {
        return {
          ...f,
          key: mergePath(f.path),
        };
      });
      const keysToFetch = allFieldsWithKeys.slice(0, 30);
      const cc: ChartConfigWithDateRange = {
        select: '',
        from: {
          databaseName,
          tableName,
        },
        connection: connectionId,
        where: '',
        groupBy: '',
        timestampValueExpression: source.timestampValueExpression,
        dateRange: [new Date(Date.now() - ms('60m')), new Date()],
      };
      const keyValues = await metadata.getKeyValues({
        chartConfig: cc,
        keys: keysToFetch.map(f => f.key),
      });

      const anthropic = createAnthropic({
        apiKey: config.ANTHROPIC_API_KEY,
      });

      // const model = anthropic('claude-3-5-haiku-latest');
      const model = anthropic('claude-sonnet-4-5-20250929');

      const prompt = `You are an AI assistant that helps users create chart configurations for an observability platform called HyperDX.

The user wants to create a chart based on the following description:
${text}

Generate a visualization or search that matches their request. The chart should query logs, metrics, or traces from a ClickHouse database.

Here are some guidelines:
- Use appropriate display types: 'line' for time series, 'table' for tabular data
- Use appropriate aggregate functions depending on user's request: 'count', 'sum', 'avg', 'min', 'max', 'count_distinct'
- If the user is requesting for a specific set of data (ex. "frontend service", filter the condition by the appropriate property based on the below properties ex. \`ServiceName = 'frontend'\`)
- Pick an appropriate time range based on the user's request if one can be inferred from the request.

The user is looking to do a query on their data source named: ${source.name} of type ${source.kind}.

The ${source.kind === SourceKind.Log ? 'log level' : 'span status code'} is stored in ${source.severityTextExpression}.
You can identify services via ${source.serviceNameExpression}
${
  source.kind === SourceKind.Trace
    ? `Duration of spans can be queried via ${source.durationExpression} which is expressed in 10^-${source.durationPrecision} seconds of precision.
Span names under ${source.spanNameExpression} and span kinds under ${source.spanKindExpression}`
    : `The log body can be queried via ${source.bodyExpression}`
}
Various log/span-specific attributes as a Map can be found under ${source.eventAttributesExpression} while resource attributes that follow the OpenTelemetry semantic convention can be found under ${source.resourceAttributesExpression}
You must use the full field name ex. "column['key']" or "column.key" as it appears.

The following is a list of properties and example values that exist in the source:
${JSON.stringify(keyValues)}

There may be additional properties that you can use as well:
${JSON.stringify(allFieldsWithKeys.slice(0, 200).map(f => ({ field: f.key, type: f.type })))}
`;

      logger.info(prompt);

      const result = await generateObject({
        model,
        schema: z.object({
          displayType: z.enum([DisplayType.Line, DisplayType.Table]),
          select: z
            .array(
              // @ts-ignore
              z.object({
                // TODO: Change percentile to fixed functions
                aggregationFunction: AggregateFunctionSchema.describe(
                  'SQL-like function to aggregate the property by',
                ),
                property: z
                  .string()
                  .describe(
                    'Property or column to be aggregated (ex. Duration)',
                  ),
                condition: z
                  .string()
                  .optional()
                  .describe(
                    "SQL filter condition to filter on ex. `SeverityText = 'error'`",
                  ),
              }),
            )
            .describe('Array of data series or columns to chart for the user'),
          groupBy: z
            .string()
            .optional()
            .describe('Group by column or properties for the chart'),
          timeRange: z
            .string()
            .default('Past 1h')
            .describe(
              'Time range of data to query for like "Past 1h", "Past 24h"',
            ),
        }),
        prompt,
      });

      const resObject = result.object;
      const parsedTimeRange = parseTimeRangeInput(resObject.timeRange);
      // TODO: More robust recovery logic
      const dateRange: [Date, Date] = [
        parsedTimeRange[0] ?? new Date(Date.now() - ms('1h')),
        parsedTimeRange[1] ?? new Date(),
      ];

      const chartConfig: ChartConfigWithDateRange & { source: string } = {
        displayType: resObject.displayType,
        select: resObject.select.map(s => ({
          aggFn: s.aggregationFunction,
          valueExpression: s.property,
          ...(s.condition
            ? {
                aggCondition: s.condition,
                aggConditionLanguage: 'sql',
              }
            : {}),
        })),
        from: {
          tableName: source.from.tableName,
          databaseName: source.from.databaseName,
        },
        source: sourceId,
        connection: connectionId,
        where: '',
        groupBy: resObject.groupBy,
        timestampValueExpression: source.timestampValueExpression,
        dateRange,
        granularity: 'auto',
      };

      return res.json(chartConfig);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
