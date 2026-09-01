import { Control } from 'react-hook-form';
import {
  getFilterVariableName,
  isFilterBroadcastEnabled,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import {
  DashboardFilter,
  DashboardFilterSchema,
  QueryExpressionDashboardFilter,
  StaticListDashboardFilter,
} from '@hyperdx/common-utils/dist/types';

import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';

/**
 * Flattened intersection of available dashboard filter types, representing the type
 * of a dashboard filter form which can be switched between filter type. Deliberately
 * not a `DashboardFilter`, since a mid-edit form may not be a valid DashboardFilter value.
 */
export type FilterFormValues = {
  type: DashboardFilter['type'];
} & Omit<QueryExpressionDashboardFilter, 'type'> &
  Omit<
    StaticListDashboardFilter,
    'type' | 'isBroadcastEnabled' | 'isVariableEnabled'
  >;

export type FilterFormControl = Control<FilterFormValues>;

export const toFormValues = (
  filter?: DashboardFilter,
  presetSourceId?: string,
): FilterFormValues => {
  const queried = filter?.type === 'QUERY_EXPRESSION' ? filter : undefined;
  const staticList = filter?.type === 'STATIC_LIST' ? filter : undefined;

  return {
    id: filter?.id ?? crypto.randomUUID(),
    type: filter?.type ?? 'QUERY_EXPRESSION',
    name: filter?.name ?? '',
    variableName: filter?.variableName ?? '',
    isBroadcastEnabled: filter ? isFilterBroadcastEnabled(filter) : true,
    isVariableEnabled: filter ? isFilterVariableEnabled(filter) : false,

    // QUERY_EXPRESSION fields
    expression: queried?.expression ?? '',
    source: queried?.source ?? presetSourceId ?? '',
    sourceMetricType: queried?.sourceMetricType,
    where: queried?.where ?? '',
    whereLanguage: queried?.whereLanguage ?? getStoredLanguage() ?? 'sql',
    appliesToSourceIds: queried?.appliesToSourceIds ?? [],

    // STATIC_LIST fields
    options: staticList?.options ?? [],
  };
};

/** Normalizes the form values into the filter that gets stored. */
export const toSavedFilter = (values: FilterFormValues): DashboardFilter => {
  if (values.type === 'STATIC_LIST') {
    return DashboardFilterSchema.parse({
      ...values,
      options: values.options.map(option => option.trim()),
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: getFilterVariableName(values),
    });
  }

  const trimmedWhere = values.where?.trim() ?? '';
  const appliesTo = values.appliesToSourceIds?.filter(id => !!id?.length);
  const isVariableEnabled = isFilterVariableEnabled(values);

  return DashboardFilterSchema.parse({
    ...values,
    where: trimmedWhere || undefined,
    whereLanguage: trimmedWhere ? (values.whereLanguage ?? 'sql') : undefined,
    appliesToSourceIds: appliesTo?.length ? appliesTo : undefined,
    isBroadcastEnabled: isFilterBroadcastEnabled(values),
    isVariableEnabled,
    variableName: isVariableEnabled ? getFilterVariableName(values) : undefined,
  });
};
