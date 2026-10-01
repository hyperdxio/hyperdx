import { Control } from 'react-hook-form';
import {
  getFilterVariableName,
  isFilterBroadcastEnabled,
  isFilterGlobalRequirement,
  isFilterRequired,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import {
  DashboardFilter,
  DashboardFilterSchema,
  PromqlLabelDashboardFilter,
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
  /** Boolean version of the persisted numeric `minSelections`. */
  isRequired: boolean;
  /** Always set, unlike the stored field, whose default lives in `isFilterGlobalRequirement`. */
  isGlobalRequirement: boolean;
} & Omit<
  QueryExpressionDashboardFilter,
  'type' | 'minSelections' | 'isGlobalRequirement'
> &
  Omit<
    StaticListDashboardFilter,
    | 'type'
    | 'isBroadcastEnabled'
    | 'isVariableEnabled'
    | 'minSelections'
    | 'isGlobalRequirement'
  > &
  Omit<
    PromqlLabelDashboardFilter,
    | 'type'
    | 'isBroadcastEnabled'
    | 'isVariableEnabled'
    | 'minSelections'
    | 'isGlobalRequirement'
  >;

export type FilterFormControl = Control<FilterFormValues>;

export const toFormValues = (
  filter?: DashboardFilter,
  presetSourceId?: string,
): FilterFormValues => {
  const queried = filter?.type === 'QUERY_EXPRESSION' ? filter : undefined;
  const staticList = filter?.type === 'STATIC_LIST' ? filter : undefined;
  const promqlLabel = filter?.type === 'PROMETHEUS_LABEL' ? filter : undefined;

  return {
    id: filter?.id ?? crypto.randomUUID(),
    type: filter?.type ?? 'QUERY_EXPRESSION',
    name: filter?.name ?? '',
    variableName: filter?.variableName ?? '',
    isBroadcastEnabled: filter ? isFilterBroadcastEnabled(filter) : true,
    isVariableEnabled: filter ? isFilterVariableEnabled(filter) : false,
    isRequired: filter ? isFilterRequired(filter) : false,
    isGlobalRequirement: filter ? isFilterGlobalRequirement(filter) : false,

    // QUERY_EXPRESSION fields
    expression: queried?.expression ?? '',
    source: queried?.source ?? promqlLabel?.source ?? presetSourceId ?? '',
    sourceMetricType: queried?.sourceMetricType,
    where: queried?.where ?? '',
    whereLanguage: queried?.whereLanguage ?? getStoredLanguage() ?? 'sql',
    appliesToSourceIds: queried?.appliesToSourceIds ?? [],

    // STATIC_LIST fields
    options: staticList?.options ?? [],

    // PROMETHEUS_LABEL fields
    label: promqlLabel?.label ?? '',
    match: promqlLabel?.match ?? '',
  };
};

/** Normalizes the form values into the filter that gets stored. */
export const toSavedFilter = (values: FilterFormValues): DashboardFilter => {
  // Pulled out of the spread below so neither key is stored unless it's relevant
  const { isRequired, isGlobalRequirement, ...rest } = values;
  const requirement = isRequired
    ? {
        minSelections: 1,
        ...(isGlobalRequirement ? { isGlobalRequirement: true } : {}),
      }
    : {};

  if (values.type === 'STATIC_LIST') {
    return DashboardFilterSchema.parse({
      ...rest,
      options: values.options.map(option => option.trim()),
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: getFilterVariableName(values),
      ...requirement,
    });
  }

  if (values.type === 'PROMETHEUS_LABEL') {
    return DashboardFilterSchema.parse({
      ...rest,
      label: values.label.trim(),
      match: values.match?.trim() || undefined,
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: getFilterVariableName(values),
      ...requirement,
    });
  }

  const trimmedWhere = values.where?.trim() ?? '';
  const appliesTo = values.appliesToSourceIds?.filter(id => !!id?.length);
  const isVariableEnabled = isFilterVariableEnabled(values);

  return DashboardFilterSchema.parse({
    ...rest,
    where: trimmedWhere || undefined,
    whereLanguage: trimmedWhere ? (values.whereLanguage ?? 'sql') : undefined,
    appliesToSourceIds: appliesTo?.length ? appliesTo : undefined,
    isBroadcastEnabled: isFilterBroadcastEnabled(values),
    isVariableEnabled,
    variableName: isVariableEnabled ? getFilterVariableName(values) : undefined,
    ...requirement,
  });
};
