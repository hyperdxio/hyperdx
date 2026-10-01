import {
  isLogSource,
  isTraceSource,
  QuerySettings,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { useLocalStorage } from '@/utils';

// ClickHouse leaves MATERIALIZED and ALIAS columns out of `SELECT *` unless
// these settings are on.
const SELECT_ALL_COLUMNS_QUERY_SETTINGS: QuerySettings = [
  { setting: 'asterisk_include_materialized_columns', value: '1' },
  { setting: 'asterisk_include_alias_columns', value: '1' },
];

export function useMaterializedAliasColumnsOption() {
  return useLocalStorage('hdx-row-show-materialized-alias-columns', false);
}

// A Known Columns List replaces `SELECT *` in the row query.
export function getKnownColumnsList(source: TSource): string | undefined {
  return isLogSource(source) || isTraceSource(source)
    ? source.knownColumnsListExpression?.trim() || undefined
    : undefined;
}

// The settings that the row query adds for this source while the option is on,
// if any. A setting that the source's own query settings define keeps the
// source's value.
export function getSelectAllColumnsQuerySettings(
  source: TSource,
): QuerySettings | undefined {
  if (getKnownColumnsList(source)) {
    return undefined;
  }
  const added = SELECT_ALL_COLUMNS_QUERY_SETTINGS.filter(
    ({ setting }) =>
      !source.querySettings?.some(
        sourceSetting => sourceSetting.setting === setting,
      ),
  );
  return added.length > 0 ? added : undefined;
}

export function useSelectAllColumnsQuerySettings(
  source: TSource,
): QuerySettings | undefined {
  const [showMaterializedAliasColumns] = useMaterializedAliasColumnsOption();
  return showMaterializedAliasColumns
    ? getSelectAllColumnsQuerySettings(source)
    : undefined;
}
