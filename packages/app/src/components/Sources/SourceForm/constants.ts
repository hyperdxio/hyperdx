import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UseTextIndex } from '@hyperdx/common-utils/dist/types';

import {
  MV_AGGREGATE_FUNCTIONS,
  MV_GRANULARITY_LABEL_KEYS,
  MV_GRANULARITY_VALUES,
} from '@/utils/materializedViews';

export const DEFAULT_DATABASE = 'default';

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

export function useUseTextIndexOptions() {
  const { t } = useTranslation('sources');

  return useMemo(
    () => [
      {
        value: UseTextIndex.Auto,
        label: t('fields.useTextIndexAuto'),
      },
      {
        value: UseTextIndex.Enabled,
        label: t('fields.useTextIndexEnabled'),
      },
      {
        value: UseTextIndex.Disabled,
        label: t('fields.useTextIndexDisabled'),
      },
    ],
    [t],
  );
}

export function useMVGranularityOptions() {
  const { t } = useTranslation('sources');

  return useMemo(
    () =>
      MV_GRANULARITY_VALUES.map(value => ({
        value,
        label: t(
          `materializedViews.granularityOptions.${MV_GRANULARITY_LABEL_KEYS[value]}`,
        ),
      })),
    [t],
  );
}
