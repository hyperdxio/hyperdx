import { Controller, UseFormSetValue, useWatch } from 'react-hook-form';
import { getAdhocFilterSourceKinds } from '@hyperdx/common-utils/dist/filters';
import {
  AdhocFilterSourceType,
  DashboardFilter,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Box, Divider, SegmentedControl } from '@mantine/core';

import { CheckBoxControlled } from '@/components/InputControlled';
import { SourceMultiSelectControlled } from '@/components/SourceMultiSelect';
import { IS_PROMQL_ENABLED } from '@/config';
import { useSources } from '@/source';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl, FilterFormValues } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

const SOURCE_TYPE_OPTIONS: { value: AdhocFilterSourceType; label: string }[] = [
  { value: 'sql', label: 'ClickHouse' },
  { value: 'promql', label: 'Prometheus' },
];

interface AdhocFilterEditFormProps {
  control: FilterFormControl;
  setValue: UseFormSetValue<FilterFormValues>;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
}

/** Form describing an ad hoc dashboard filter */
export const AdhocFilterEditForm = ({
  control,
  setValue,
  otherFilters,
}: AdhocFilterEditFormProps) => {
  const { data: allSources } = useSources();
  const [sourceType, isBroadcastEnabled] = useWatch({
    control,
    name: ['sourceType', 'isBroadcastEnabled'],
  });
  const allowedSourceKinds = getAdhocFilterSourceKinds(sourceType);
  // Kept visible for a saved PromQL filter so its source type can be changed
  const showSourceType =
    sourceType === 'promql' ||
    (IS_PROMQL_ENABLED &&
      !!allSources?.some(s => s.kind === SourceKind.Promql));

  // The multi-selects hide sources of other kinds, which the form can still
  // hold after switching from another filter type.
  const validateSourceKinds = (ids: string[] | undefined) => {
    const hasOtherKind = ids?.some(id => {
      const source = allSources?.find(s => s.id === id);
      return source && !allowedSourceKinds.includes(source.kind);
    });
    return (
      !hasOtherKind ||
      (sourceType === 'promql'
        ? 'Select only PromQL sources'
        : 'Select only log, trace, or session sources')
    );
  };

  return (
    <>
      {showSourceType && (
        <CustomInputWrapper
          label="Source type"
          tooltipText="Keys come from the columns and map keys of SQL sources, or from the labels of PromQL sources"
        >
          <Controller
            control={control}
            name="sourceType"
            render={({ field: { value, onChange } }) => (
              <SegmentedControl
                size="xs"
                value={value}
                onChange={next => {
                  onChange(next);
                  // Sources of the previous type can't be kept
                  setValue('sources', [], { shouldDirty: true });
                  setValue('appliesToSourceIds', [], { shouldDirty: true });
                }}
                data={SOURCE_TYPE_OPTIONS}
                data-testid="adhoc-filter-source-type"
              />
            )}
          />
        </CustomInputWrapper>
      )}
      <CustomInputWrapper
        label="Data sources"
        tooltipText="The sources whose keys and values the filter offers"
      >
        <SourceMultiSelectControlled
          control={control}
          name="sources"
          data-testid="adhoc-filter-sources"
          comboboxProps={{ withinPortal: true }}
          placeholder="Select sources"
          allowedSourceKinds={allowedSourceKinds}
          rules={{
            validate: (value: string[] | undefined) =>
              !value?.length
                ? 'Select at least one source'
                : validateSourceKinds(value),
          }}
        />
      </CustomInputWrapper>

      <Divider />
      <CheckBoxControlled
        control={control}
        name="isBroadcastEnabled"
        size="xs"
        label="Broadcast filter conditions"
        description={
          sourceType === 'promql'
            ? 'Automatically add the selected conditions as label matchers to every selector in PromQL tiles. Optionally, specify which sources to broadcast to.'
            : 'Automatically apply the selected conditions to every tile based on the selected data sources. Optionally, specify which sources to broadcast to.'
        }
        data-testid="filter-broadcast-checkbox"
      />
      {isBroadcastEnabled && (
        <Box ml="xl">
          <CustomInputWrapper
            label="Applies to sources"
            tooltipText="Which tiles the broadcast reaches. Leave empty to broadcast to all tiles using the filter's data sources."
          >
            <SourceMultiSelectControlled
              control={control}
              name="appliesToSourceIds"
              data-testid="applies-to-source-selector"
              comboboxProps={{ withinPortal: true }}
              placeholder="Same as data sources"
              allowedSourceKinds={allowedSourceKinds}
              rules={{ validate: validateSourceKinds }}
            />
          </CustomInputWrapper>
        </Box>
      )}
      <Divider />
      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};
