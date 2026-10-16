import { useMemo } from 'react';
import {
  ChSql,
  chSqlToAliasMap,
  chSqlToSelectColumns,
  ColumnMetaType,
  inferNumericColumn,
} from '@hyperdx/common-utils/dist/clickhouse';
import { quoteResultColumnNameIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isHistogramClassSelect,
  renderChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { isAdhocComparableDataType } from '@hyperdx/common-utils/dist/filters';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfig,
  ChartConfigWithOptTimestamp,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { inferGroupColumns, tryExpandConfigVariables } from '@/ChartUtils';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { getBuilderValueColumnCount } from '@/source';

type FilterKeys = ReadonlyMap<string, string>;

const EMPTY_FILTER_KEYS: FilterKeys = new Map();

// Cells hold ISO UTC timestamps, which never equal toString() of a DateTime
// (space-separated, in the column's timezone).
const isComparable = (column: ColumnMetaType) =>
  isAdhocComparableDataType(column.type);

/** The expression of a select item, without any `AS alias`. */
const stripAlias = (item: string): string =>
  Object.values(
    chSqlToAliasMap({ sql: `SELECT ${item} FROM t`, params: {} }),
  )[0] ?? item;

/**
 * Builder group-by columns follow the value columns (see `renderSelect`). They
 * are matched by position because ClickHouse renames unaliased expressions.
 */
export function getBuilderFilterKeys(
  config: BuilderChartConfig,
  meta: ColumnMetaType[],
): FilterKeys {
  if (!config.groupBy || config.selectGroupBy === false) {
    return EMPTY_FILTER_KEYS;
  }
  // Histograms pack their group-by values into one array column, which can't
  // be filtered on. A mix with other metric types still has a column per
  // group-by, for the other types' rows.
  if (
    Array.isArray(config.select) &&
    config.select.every(isHistogramClassSelect)
  ) {
    return EMPTY_FILTER_KEYS;
  }
  const expanded = tryExpandConfigVariables(config);
  const groupBy = expanded.groupBy ?? [];
  const expressions =
    typeof groupBy === 'string'
      ? splitAndTrimWithBracket(groupBy).map(stripAlias)
      : groupBy.map(entry => entry.valueExpression);
  const valueCount =
    typeof expanded.select === 'string'
      ? splitAndTrimWithBracket(expanded.select).length
      : getBuilderValueColumnCount(expanded);

  const keys = new Map<string, string>();
  meta
    .slice(valueCount, valueCount + expressions.length)
    .forEach((column, index) => {
      if (isComparable(column)) keys.set(column.name, expressions[index]);
    });
  return keys;
}

/**
 * Raw SQL group-by columns, from the rendered query's GROUP BY. When that
 * can't be read, the columns a time chart would group by are used instead.
 */
export function getRawSqlFilterKeys(
  chSql: ChSql,
  meta: ColumnMetaType[],
): FilterKeys {
  const keys = new Map<string, string>();
  const selectColumns = chSqlToSelectColumns(chSql);
  if (selectColumns && selectColumns.length === meta.length) {
    selectColumns.forEach(({ expression, isGroupBy }, index) => {
      if (isGroupBy && isComparable(meta[index])) {
        keys.set(meta[index].name, expression);
      }
    });
    return keys;
  }

  const aliasMap = chSqlToAliasMap(chSql);
  for (const { name } of inferGroupColumns(meta) ?? []) {
    keys.set(name, aliasMap[name] ?? quoteResultColumnNameIfNeeded(name));
  }
  return keys;
}

/**
 * PromQL label columns, i.e. the non-numeric ones other than the time
 * column, filter on their label.
 */
export function getPromqlFilterKeys(meta: ColumnMetaType[]): FilterKeys {
  const numeric = new Set(inferNumericColumn(meta)?.map(({ name }) => name));
  return new Map(
    meta
      .filter(column => !numeric.has(column.name) && isComparable(column))
      .map(({ name }) => [name, name]),
  );
}

/**
 * The ad hoc filter key of each result column that can be filtered on: the
 * group-by columns of builder and raw SQL queries, as the expression behind
 * any alias, and the labels of PromQL queries.
 */
export function useResultColumnFilterKeys({
  config,
  meta,
  enabled,
}: {
  config: ChartConfigWithOptTimestamp;
  meta: ColumnMetaType[] | undefined;
  enabled: boolean;
}): FilterKeys {
  const metadata = useMetadataWithSettings();
  const isRawSql = isRawSqlChartConfig(config);

  // Rendering substitutes variables and macros, so the query parses as run.
  const { data: chSql } = useQuery({
    queryKey: ['resultColumnFilterKeys', config],
    enabled: enabled && isRawSql,
    staleTime: Infinity,
    queryFn: () => renderChartConfig(config, metadata, undefined),
  });

  return useMemo(() => {
    if (!enabled || !meta) return EMPTY_FILTER_KEYS;
    if (isBuilderChartConfig(config)) return getBuilderFilterKeys(config, meta);
    if (isPromqlChartConfig(config)) return getPromqlFilterKeys(meta);
    if (isRawSql && chSql) return getRawSqlFilterKeys(chSql, meta);
    return EMPTY_FILTER_KEYS;
  }, [enabled, meta, config, isRawSql, chSql]);
}
