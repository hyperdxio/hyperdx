import { UseTextIndex } from '@hyperdx/common-utils/dist/types';

import { MV_AGGREGATE_FUNCTIONS } from '@/utils/materializedViews';

export const DEFAULT_DATABASE = 'default';
export const KNOWN_COLUMNS_EXPRESSION_HELP_TEXT =
  'For Distributed table sources whose target tables have non-matching column sets. Provide a list of columns supported across all target tables; it is used instead of SELECT * when fetching full row data (e.g. the row side panel). Leave blank to select all columns. This should be a comma-separated list of column names - do not include non-column expressions or aliases.';

// Placeholder written into from.databaseName / from.tableName when the
// selected connection is Prometheus-only.
export const PROMETHEUS_PLACEHOLDER = 'prometheus';

export const MV_AGGREGATE_FUNCTION_OPTIONS = MV_AGGREGATE_FUNCTIONS.map(fn => ({
  value: fn,
  label: fn,
}));

// TODO: maybe otel clickhouse export migrate the schema?
export const OTEL_CLICKHOUSE_EXPRESSIONS = {
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
};

export const USE_TEXT_INDEX_OPTIONS = [
  {
    value: UseTextIndex.Auto,
    label: 'Auto (detect from schema)',
  },
  {
    value: UseTextIndex.Enabled,
    label: 'Force enable',
  },
  {
    value: UseTextIndex.Disabled,
    label: 'Force disable',
  },
];
