import {
  isLogSource,
  isTraceSource,
  QuerySettings,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  SELECT_ALL_COLUMNS_QUERY_SETTINGS,
  useSelectAllColumnsSettingsRejected,
} from '@/hooks/useSelectAllColumnsSettingsRejection';
import { useLocalStorage } from '@/utils';

export function useMaterializedAliasColumnsOption() {
  return useLocalStorage('hdx-row-show-materialized-alias-columns', false);
}

// A Known Columns List replaces `SELECT *` in the row query.
export function getKnownColumnsList(source: TSource): string | undefined {
  return isLogSource(source) || isTraceSource(source)
    ? source.knownColumnsListExpression?.trim() || undefined
    : undefined;
}

// The settings that the row query adds for this source, if any. A value that
// the source's own query settings give for either setting wins.
export function useSelectAllColumnsQuerySettings(
  source: TSource,
): QuerySettings | undefined {
  const [showMaterializedAliasColumns] = useMaterializedAliasColumnsOption();
  const rejectsSettings = useSelectAllColumnsSettingsRejected(
    source.connection,
  );
  return showMaterializedAliasColumns &&
    !getKnownColumnsList(source) &&
    !rejectsSettings
    ? SELECT_ALL_COLUMNS_QUERY_SETTINGS
    : undefined;
}
