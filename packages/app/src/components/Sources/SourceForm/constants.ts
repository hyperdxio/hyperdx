import { UseTextIndex } from '@hyperdx/common-utils/dist/types';

import {
  MV_AGGREGATE_FUNCTIONS,
  MV_GRANULARITY_OPTIONS,
} from '@/utils/materializedViews';

export const DEFAULT_DATABASE = 'default';
export const KNOWN_COLUMNS_EXPRESSION_HELP_TEXT =
  'For Distributed table sources whose target tables have non-matching column sets. Provide a list of columns supported across all target tables; it is used instead of SELECT * when fetching full row data (e.g. the row side panel). Leave blank to select all columns. This should be a comma-separated list of column names - do not include non-column expressions or aliases.';

export const SERVICE_VERSION_EXPRESSION_HELP_TEXT =
  "Identifies the running release of a service. Defaults to the OpenTelemetry service.version resource attribute. Point it elsewhere if your release identifier lives in another attribute - under GitOps it is often the container image tag. If services in this table use different attributes, fall back across them: coalesce(nullIf(ResourceAttributes['service.version'], ''), nullIf(ResourceAttributes['container.image.tag'], '')).";

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

// Reuses MV_GRANULARITY_OPTIONS since it's already curated to match what
// convertDateRangeToGranularityString can return; '1 second' is excluded
// because that function's own floor is '15 second'.
export const MIN_AUTO_GRANULARITY_OPTIONS = [
  { value: '', label: 'No minimum' },
  ...MV_GRANULARITY_OPTIONS.filter(option => option.value !== '1 second'),
];

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
