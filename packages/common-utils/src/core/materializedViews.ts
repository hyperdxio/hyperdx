import { differenceInSeconds } from 'date-fns';

import { BaseClickhouseClient } from '@/clickhouse';
import {
  ChartConfigWithOptDateRange,
  CteChartConfig,
  InternalAggregateFunction,
  InternalAggregateFunctionSchema,
  MaterializedViewConfiguration,
  TSource,
} from '@/types';

import { Metadata, TableConnection } from './metadata';
import { DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS } from './renderChartConfig';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  getAlignedDateRange,
  splitAndTrimWithBracket,
} from './utils';

type SelectItem = Exclude<
  ChartConfigWithOptDateRange['select'],
  string
>[number];

async function isSimpleAggregateFunction(
  tableConnection: TableConnection,
  column: string,
  metadata: Metadata,
) {
  try {
    const columnMeta = await metadata.getColumn({
      ...tableConnection,
      column,
    });

    return !!columnMeta?.type.startsWith('SimpleAggregateFunction(');
  } catch {
    return false;
  }
}

// Variants of quantile (ex. quantileExact, quantileDD, etc.)
async function getQuantileAggregateFunction(
  tableConnection: TableConnection,
  column: string,
  metadata: Metadata,
) {
  try {
    const columnMeta = await metadata.getColumn({
      ...tableConnection,
      column,
    });

    const type = columnMeta?.type;
    if (!type) {
      return undefined;
    }

    // Use regex to extract the quantile function name inside AggregateFunction(...)
    // For example, AggregateFunction(quantile(0.95), Int64) --> quantile
    //              AggregateFunction(quantileTDigest(0.95), Int64) --> quantileTDigest
    //              AggregateFunction(quantileDD(0.001, 0.95), Int64) --> quantileDD
    const match = type.match(/^AggregateFunction\(\s*([^(, ]+)\s*\(/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function getAggregateMergeFunction(
  tableConnection: TableConnection,
  column: string,
  aggFn: string,
  metadata: Metadata,
) {
  if (aggFn === 'count') {
    // Counts are stored in AggregatingMergeTree as UInt64 or SimpleAggregateFunction(sum, UInt64),
    // both of which should be summed rather than count()'ed.
    return 'sum';
  } else if (
    await isSimpleAggregateFunction(tableConnection, column, metadata)
  ) {
    return aggFn;
  } else {
    return `${aggFn}Merge`;
  }
}

function isValidAggFn(
  aggFn: string | undefined,
): aggFn is InternalAggregateFunction {
  return !!aggFn && InternalAggregateFunctionSchema.safeParse(aggFn).success;
}

function isQuantileSelectItem(item: SelectItem): item is {
  valueExpression: string;
  aggFn: 'quantile';
  level: number;
} {
  return (
    item.aggFn === 'quantile' &&
    'level' in item &&
    typeof item.level === 'number'
  );
}

function getAggregatedColumnConfig(
  mvConfig: MaterializedViewConfiguration,
  column: string,
  aggFn: InternalAggregateFunction,
) {
  return mvConfig.aggregatedColumns.find(
    config =>
      config.aggFn === aggFn &&
      (config.aggFn === 'count' || config.sourceColumn === column),
  );
}

/**
 * Indicates whether the MV described by mvConfig is capable of
 * supporting the granularity requested in the given chart config.
 **/
function mvConfigSupportsGranularity(
  mvConfig: MaterializedViewConfiguration,
  chartConfig: ChartConfigWithOptDateRange,
): boolean {
  if (!chartConfig.granularity && !chartConfig.dateRange) {
    return true;
  }

  // If granularity is not provided at all, but we have a date range, we need a way to
  // determine if the MV granularity is sufficient for the date range. So we'll assume
  // an 'auto' granularity and check that against the MV.
  const normalizedGranularity = chartConfig.granularity || 'auto';

  // 'auto' granularity requires a date range to determine effective granularity
  if (normalizedGranularity === 'auto' && !chartConfig.dateRange) {
    return false;
  }

  // Determine the effective granularity if the granularity is 'auto'
  const chartGranularity =
    normalizedGranularity === 'auto' && chartConfig.dateRange
      ? convertDateRangeToGranularityString(
          chartConfig.dateRange,
          DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
        )
      : normalizedGranularity;

  const chartGranularitySeconds = convertGranularityToSeconds(chartGranularity);
  const mvGranularitySeconds = convertGranularityToSeconds(
    mvConfig.minGranularity,
  );

  // The chart granularity must be a multiple of the MV granularity,
  // to avoid unequal distribution of data across chart time buckets
  // which don't align with the MV time buckets.
  return (
    chartGranularitySeconds >= mvGranularitySeconds &&
    chartGranularitySeconds % mvGranularitySeconds === 0
  );
}

function countIntervalsInDateRange(
  dateRange: [Date, Date],
  granularity: string,
) {
  const [startDate, endDate] = dateRange;
  const granularitySeconds = convertGranularityToSeconds(granularity);
  const diffSeconds = differenceInSeconds(endDate, startDate);
  return Math.floor(diffSeconds / granularitySeconds);
}

function mvConfigSupportsDateRange(
  mvConfig: MaterializedViewConfiguration,
  chartConfig: ChartConfigWithOptDateRange,
) {
  if (mvConfig.minDate && !chartConfig.dateRange) {
    return false;
  }

  if (!mvConfig.minDate || !chartConfig.dateRange) {
    return true;
  }

  const [startDate] = chartConfig.dateRange;
  const minDate = new Date(mvConfig.minDate);

  return startDate >= minDate;
}

const COUNT_FUNCTION_PATTERN = /\bcount(If)?\s*\(/i;
export function isUnsupportedCountFunction(selectItem: SelectItem): boolean {
  return COUNT_FUNCTION_PATTERN.test(selectItem.valueExpression);
}

async function convertSelectToMaterializedViewSelect(
  mvConfig: MaterializedViewConfiguration,
  selectItem: SelectItem,
  mvTableConnection: TableConnection,
  metadata: Metadata,
): Promise<SelectItem> {
  const { valueExpression, aggFn: initialAggFn } = selectItem;
  // can be modified later for quantile
  let aggFn = initialAggFn;

  // Custom count() expressions are not yet optimizable, but they also won't fail the
  // EXPLAIN check - instead they'll just return an incorrect result.
  if (isUnsupportedCountFunction(selectItem)) {
    throw new Error(
      `Custom count() expressions are not supported with materialized views.`,
    );
  }

  if (!aggFn) {
    return selectItem;
  }

  if (!isValidAggFn(aggFn)) {
    throw new Error(`Aggregate function ${aggFn} is not valid.`);
  }

  // Handle aggregations without a value expression (eg. count)
  // NOTE: such aggregations may still have a valueExpression in the selectItem,
  // but it should be ignored
  const columnConfigNoSourceColumn = getAggregatedColumnConfig(
    mvConfig,
    '',
    aggFn,
  );
  if (columnConfigNoSourceColumn) {
    const targetColumn = columnConfigNoSourceColumn.mvColumn;
    const aggMergeFn = await getAggregateMergeFunction(
      mvTableConnection,
      targetColumn,
      aggFn,
      metadata,
    );

    return {
      ...selectItem,
      valueExpression: targetColumn,
      aggFn: aggMergeFn,
    };
  }

  const aggregatedColumnConfig = getAggregatedColumnConfig(
    mvConfig,
    valueExpression,
    aggFn,
  );

  if (!aggregatedColumnConfig) {
    throw new Error(
      `The aggregate function ${formatAggregateFunction(aggFn, selectItem['level'])} is not available for column '${valueExpression}'.`,
    );
  }

  if (isQuantileSelectItem(selectItem)) {
    const quantileAggregateFunction = await getQuantileAggregateFunction(
      mvTableConnection,
      aggregatedColumnConfig.mvColumn,
      metadata,
    );
    if (quantileAggregateFunction) {
      aggFn = quantileAggregateFunction;
    }
  }

  const aggMergeFn = await getAggregateMergeFunction(
    mvTableConnection,
    aggregatedColumnConfig.mvColumn,
    aggFn,
    metadata,
  );

  return {
    ...selectItem,
    valueExpression: aggregatedColumnConfig.mvColumn,
    aggFn: aggMergeFn,
  };
}

export type MVOptimizationExplanation = {
  success: boolean;
  errors: string[];
  rowEstimate?: number;
  mvConfig: MaterializedViewConfiguration;
};

export async function tryConvertConfigToMaterializedViewSelect<
  C extends ChartConfigWithOptDateRange | CteChartConfig,
>(
  chartConfig: C,
  mvConfig: MaterializedViewConfiguration,
  metadata: Metadata,
): Promise<{
  optimizedConfig?: C;
  errors?: string[];
}> {
  if (!Array.isArray(chartConfig.select)) {
    return {
      errors: ['Only array-based select statements are supported.'],
    };
  }

  if (mvConfig.minDate && !mvConfigSupportsDateRange(mvConfig, chartConfig)) {
    return {
      errors: [
        'The selected date range includes dates for which this view does not contain data.',
      ],
    };
  }

  if (!mvConfigSupportsGranularity(mvConfig, chartConfig)) {
    const error = chartConfig.granularity
      ? `Granularity must be a multiple of the view's granularity (${mvConfig.minGranularity}).`
      : 'The selected date range is too short for the granularity of this materialized view.';
    return { errors: [error] };
  }

  const mvTableConnection: TableConnection = {
    databaseName: mvConfig.databaseName,
    tableName: mvConfig.tableName,
    connectionId: chartConfig.connection,
  };

  const conversions = await Promise.allSettled(
    chartConfig.select.map(selectItem =>
      convertSelectToMaterializedViewSelect(
        mvConfig,
        selectItem,
        mvTableConnection,
        metadata,
      ),
    ),
  );

  const select: SelectItem[] = [];
  const errors: string[] = [];
  for (const result of conversions) {
    if (result.status === 'rejected') {
      errors.push(result.reason.message);
    } else {
      select.push(result.value);
    }
  }

  if (errors.length > 0) {
    return {
      errors,
    };
  }

  const clonedConfig: C = {
    ...structuredClone(chartConfig),
    select,
    timestampValueExpression: mvConfig.timestampColumn,
    from: {
      databaseName: mvConfig.databaseName,
      tableName: mvConfig.tableName,
    },
    // Make the date range end exclusive to avoid selecting the entire next time bucket from the MV
    // Align the date range to the MV granularity to avoid excluding the first time bucket
    ...('dateRange' in chartConfig && chartConfig.dateRange
      ? {
          dateRangeEndInclusive: false,
          dateRange: getAlignedDateRange(
            chartConfig.dateRange,
            mvConfig.minGranularity,
          ),
        }
      : {}),
  };

  return {
    optimizedConfig: clonedConfig,
  };
}

/** Attempts to optimize a config with a single MV Config */
async function tryOptimizeConfig<C extends ChartConfigWithOptDateRange>(
  config: C,
  metadata: Metadata,
  clickhouseClient: BaseClickhouseClient,
  signal: AbortSignal | undefined,
  mvConfig: MaterializedViewConfiguration,
  sourceFrom: TSource['from'],
) {
  const errors: string[] = [];
  // Attempt to optimize any CTEs that exist in the config
  let optimizedConfig: C | undefined = undefined;
  if (config.with) {
    const cteOptimizationResults = await Promise.all(
      config.with.map(async cte => {
        if (
          cte.chartConfig &&
          cte.chartConfig.from.databaseName === sourceFrom.databaseName &&
          cte.chartConfig.from.tableName === sourceFrom.tableName
        ) {
          return tryConvertConfigToMaterializedViewSelect(
            cte.chartConfig,
            mvConfig,
            metadata,
          );
        } else {
          return {
            optimizedConfig: undefined,
            errors: [],
          };
        }
      }),
    );

    const hasOptimizedCTEs = cteOptimizationResults.some(
      r => !!r.optimizedConfig,
    );

    if (hasOptimizedCTEs) {
      optimizedConfig = {
        ...structuredClone(config),
        with: config.with.map((originalCte, index) => {
          return {
            ...originalCte,
            chartConfig:
              cteOptimizationResults[index].optimizedConfig ??
              originalCte.chartConfig,
          };
        }),
      };
    }

    errors.push(...cteOptimizationResults.flatMap(r => r.errors ?? []));
  }

  // Attempt to optimize the main (outer) select
  if (
    config.from.databaseName === sourceFrom.databaseName &&
    config.from.tableName === sourceFrom.tableName
  ) {
    const convertedOuterSelect = await tryConvertConfigToMaterializedViewSelect(
      optimizedConfig ?? config,
      mvConfig,
      metadata,
    );

    if (convertedOuterSelect.optimizedConfig) {
      optimizedConfig = convertedOuterSelect.optimizedConfig;
    }
    errors.push(...(convertedOuterSelect.errors ?? []));
  }

  // If the config has been optimized, validate it by checking whether an EXPLAIN query succeeds
  if (optimizedConfig) {
    const {
      isValid,
      rowEstimate = Number.POSITIVE_INFINITY,
      error,
    } = await clickhouseClient.testChartConfigValidity({
      config: optimizedConfig,
      metadata,
      opts: {
        abort_signal: signal,
      },
    });

    if (error) {
      errors.push(error);
    }

    if (isValid) {
      return {
        optimizedConfig,
        rowEstimate,
        errors: [],
      };
    }
  }

  return { errors };
}

/** Attempts to optimize a config with each of the provided MV Configs */
export async function tryOptimizeConfigWithMaterializedViewWithExplanations<
  C extends ChartConfigWithOptDateRange,
>(
  config: C,
  metadata: Metadata,
  clickhouseClient: BaseClickhouseClient,
  signal: AbortSignal | undefined,
  source: Pick<TSource, 'from'> & Partial<Pick<TSource, 'materializedViews'>>,
): Promise<{
  optimizedConfig?: C;
  explanations: MVOptimizationExplanation[];
}> {
  const mvConfigs = source.materializedViews ?? [];
  const optimizationResults = await Promise.all(
    mvConfigs.map(mvConfig =>
      tryOptimizeConfig(
        config,
        metadata,
        clickhouseClient,
        signal,
        mvConfig,
        source.from,
      ).then(result => ({ ...result, mvConfig })),
    ),
  );

  // Find a config with the lowest row estimate among successfully optimized configs
  let resultOptimizedConfig: C | undefined = undefined;
  let minRowEstimate = Number.POSITIVE_INFINITY;
  for (const result of optimizationResults) {
    if (
      result.optimizedConfig &&
      (result.rowEstimate ?? Number.POSITIVE_INFINITY) < minRowEstimate
    ) {
      resultOptimizedConfig = result.optimizedConfig;
      minRowEstimate = result.rowEstimate ?? Number.POSITIVE_INFINITY;
    }
  }

  const explanations = optimizationResults.map(
    ({ optimizedConfig, errors, rowEstimate, mvConfig }) => ({
      success: !!optimizedConfig && optimizedConfig === resultOptimizedConfig,
      errors,
      rowEstimate,
      mvConfig,
    }),
  );

  return {
    optimizedConfig: resultOptimizedConfig,
    explanations,
  };
}

export async function tryOptimizeConfigWithMaterializedView<
  C extends ChartConfigWithOptDateRange,
>(
  config: C,
  metadata: Metadata,
  clickhouseClient: BaseClickhouseClient,
  signal: AbortSignal | undefined,
  source: Pick<TSource, 'from'> & Partial<Pick<TSource, 'materializedViews'>>,
) {
  const { optimizedConfig } =
    await tryOptimizeConfigWithMaterializedViewWithExplanations(
      config,
      metadata,
      clickhouseClient,
      signal,
      source,
    );

  return optimizedConfig ?? config;
}

function formatAggregateFunction(aggFn: string, level: number | undefined) {
  if (aggFn === 'quantile') {
    switch (level) {
      case 0.5:
        return 'median';
      case 0.9:
        return 'p90';
      case 0.95:
        return 'p95';
      case 0.99:
        return 'p99';
      default:
        return `quantile`;
    }
  } else {
    return aggFn;
  }
}

function toMvId(
  mv: Pick<MaterializedViewConfiguration, 'databaseName' | 'tableName'>,
) {
  return `${mv.databaseName}.${mv.tableName}`;
}

export interface GetKeyValueCall<C extends ChartConfigWithOptDateRange> {
  chartConfig: C;
  keys: string[];
}

export async function optimizeGetKeyValuesCalls<
  C extends ChartConfigWithOptDateRange,
>({
  chartConfig,
  keys,
  source,
  clickhouseClient,
  metadata,
  signal,
}: {
  chartConfig: C;
  keys: string[];
  source: TSource;
  clickhouseClient: BaseClickhouseClient;
  metadata: Metadata;
  signal?: AbortSignal;
}): Promise<GetKeyValueCall<C>[]> {
  // Get the MVs from the source
  const mvs = source?.materializedViews || [];
  const mvsById = new Map(mvs.map(mv => [toMvId(mv), mv]));

  // Identify keys which can be queried from a materialized view
  const supportedKeysByMv = new Map<string, string[]>();
  for (const [mvId, mv] of mvsById.entries()) {
    const mvIntervalsInDateRange = chartConfig.dateRange
      ? countIntervalsInDateRange(chartConfig.dateRange, mv.minGranularity)
      : Infinity;
    if (
      // Ensures that the MV contains data for the selected date range
      mvConfigSupportsDateRange(mv, chartConfig) &&
      // Ensures that the MV's granularity is small enough that the selected date
      // range will include multiple MV time buckets. (3 is an arbitrary cutoff)
      mvIntervalsInDateRange >= 3
    ) {
      const dimensionColumns = splitAndTrimWithBracket(mv.dimensionColumns);
      const keysInMV = keys.filter(k => dimensionColumns.includes(k));
      if (keysInMV.length > 0) {
        supportedKeysByMv.set(mvId, keysInMV);
      }
    }
  }

  // Build the configs which would be used to query each MV for all of the keys it supports
  const configsToExplain = [...supportedKeysByMv.entries()].map(
    ([mvId, mvKeys]) => {
      const { databaseName, tableName, timestampColumn } = mvsById.get(mvId)!;
      return {
        ...structuredClone(chartConfig),
        timestampValueExpression: timestampColumn,
        from: {
          databaseName,
          tableName,
        },
        // These are dimension columns so we don't need to add any -Merge combinators
        select: mvKeys
          .map((k, i) => `groupUniqArray(1)(${k}) AS param${i}`)
          .join(', '),
      };
    },
  );

  // Figure out which of those configs are valid by running EXPLAIN queries
  const explainResults = await Promise.all(
    configsToExplain.map(async config => {
      const { isValid, rowEstimate = Number.POSITIVE_INFINITY } =
        await clickhouseClient.testChartConfigValidity({
          config,
          metadata,
          opts: { abort_signal: signal },
        });
      return {
        id: toMvId({
          databaseName: config.from.databaseName,
          tableName: config.from.tableName,
        }),
        isValid,
        rowEstimate,
      };
    }),
  );

  // For each key, find the best MV that can provide it while reading the fewest rows
  const finalKeysByMv = new Map<string, string[]>();
  const uncoveredKeys = new Set<string>(keys);
  const sortedValidConfigs = explainResults
    .filter(r => r.isValid)
    .sort((a, b) => a.rowEstimate - b.rowEstimate);
  for (const config of sortedValidConfigs) {
    const mvKeys = supportedKeysByMv.get(config.id) ?? [];

    // Only include keys which have not already been covered by a previous MV
    const keysNotAlreadyCovered = mvKeys.filter(k => uncoveredKeys.has(k));
    if (keysNotAlreadyCovered.length) {
      finalKeysByMv.set(config.id, keysNotAlreadyCovered);
      for (const key of keysNotAlreadyCovered) {
        uncoveredKeys.delete(key);
      }
    }
  }

  // Build the final list of optimized calls
  const calls = [...finalKeysByMv.entries()].map(([mvId, mvKeys]) => {
    const { databaseName, tableName, timestampColumn } = mvsById.get(mvId)!;
    const optimizedConfig: C = {
      ...structuredClone(chartConfig),
      timestampValueExpression: timestampColumn,
      from: {
        databaseName,
        tableName,
      },
    };
    return {
      chartConfig: optimizedConfig,
      keys: mvKeys,
    };
  });

  if (uncoveredKeys.size) {
    calls.push({
      chartConfig: structuredClone(chartConfig),
      keys: [...uncoveredKeys],
    });
  }

  return calls;
}
