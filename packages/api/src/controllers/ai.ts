import { createAnthropic } from '@ai-sdk/anthropic';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  getMetadata,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  AILineTableResponse,
  AssistantLineTableConfigSchema,
  ChartConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import type { LanguageModel } from 'ai';
import * as chrono from 'chrono-node';
import ms from 'ms';
import z from 'zod';

import * as config from '@/config';
import { ISource } from '@/models/source';
import { Api500Error } from '@/utils/errors';
import logger from '@/utils/logger';

import { getConnectionById } from './connection';

/**
 * Get configured AI model for use in the application.
 * Currently supports Anthropic (with both direct API and Azure AI endpoints).
 * Architecture supports multiple providers for future extensibility.
 *
 * Configuration is determined by environment variables:
 * - AI_PROVIDER: Provider to use (currently only 'anthropic' is supported)
 * - AI_API_KEY: API key for the provider
 * - AI_BASE_URL: (Optional) Custom endpoint URL (for Azure AI Anthropic)
 * - AI_MODEL_NAME: (Optional) Model or deployment name
 *
 * For backward compatibility, also supports legacy ANTHROPIC_API_KEY env var.
 *
 * @returns LanguageModel instance ready to use
 * @throws Error if required configuration is missing or provider is unsupported
 */
export function getAIModel(): LanguageModel {
  // Determine provider with backward compatibility
  let provider: string | undefined = config.AI_PROVIDER;

  // Legacy support: if no AI_PROVIDER but ANTHROPIC_API_KEY exists, use anthropic
  // We should deprecate this in the future, but want to avoid a breaking change until we add a second provider.
  if (!provider && config.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
  }

  if (!provider) {
    throw new Error(
      'No AI provider configured. Set AI_PROVIDER and AI_API_KEY environment variables.',
    );
  }

  logger.info({ provider }, 'Initializing AI provider');

  switch (provider) {
    case 'anthropic':
      return getAnthropicModel();

    case 'openai':
      throw new Error(
        `Provider '${provider}' is not yet supported. Currently only 'anthropic' is available. ` +
          'Support for additional providers can be added in the future.',
      );

    default:
      throw new Error(
        `Unknown AI provider: ${provider}. Currently supported: anthropic`,
      );
  }
}

export async function getAIMetadata(source: ISource) {
  const connectionId = source.connection.toString();

  const connection = await getConnectionById(
    source.team.toString(),
    connectionId,
    true,
  );

  if (connection == null) {
    throw new Api500Error('Invalid connection');
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
    const isLowCardinality = (type: string) => type.includes('LowCardinality');
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
    source,
  });

  return {
    allFields,
    allFieldsWithKeys,
    keyValues,
  };
}

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

export function getChartConfigFromResolvedConfig(
  resObject: z.infer<typeof AssistantLineTableConfigSchema>,
  source: ISource,
): AILineTableResponse {
  const parsedTimeRange = parseTimeRangeInput(resObject.timeRange);
  // TODO: More robust recovery logic
  const dateRange: [Date, Date] = [
    parsedTimeRange[0] ?? new Date(Date.now() - ms('1h')),
    parsedTimeRange[1] ?? new Date(),
  ];

  return {
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
    source: source.id,
    connection: source.connection.toString(),
    groupBy: resObject.groupBy,
    timestampValueExpression: source.timestampValueExpression,
    dateRange: [dateRange[0].toString(), dateRange[1].toString()],
    markdown: resObject.markdown,
    granularity: 'auto',
    whereLanguage: 'lucene',
  };
}

/**
 * Configure Anthropic model.
 * Supports both direct Anthropic API and Azure AI Anthropic endpoints.
 */
function getAnthropicModel(): LanguageModel {
  // Support both new AI_API_KEY and legacy ANTHROPIC_API_KEY
  const apiKey = config.AI_API_KEY || config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No API key defined for Anthropic. Set AI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  type AnthropicConfig = NonNullable<Parameters<typeof createAnthropic>[0]>;

  const anthropicConfig: AnthropicConfig = {
    apiKey,
  };

  // Support other AI Anthropic endpoints or custom base URLs
  if (config.AI_BASE_URL) {
    anthropicConfig.baseURL = config.AI_BASE_URL;
  }

  const anthropic = createAnthropic(anthropicConfig);

  // Use custom model name if configured, otherwise use default
  const modelName = config.AI_MODEL_NAME || 'claude-sonnet-4-5-20250929';

  return anthropic(modelName);
}
